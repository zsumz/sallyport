import { Buffer } from 'node:buffer';

import { readArrayProperty, readProperty, readStringProperty } from '../download.ts';
import { certificateFailures } from './certificate.ts';
import { buildFailures } from './predicate.ts';
import {
    UNRECOGNIZED,
    type ExpectedProvenance,
    type ProvenanceBundleInput,
} from './model.ts';

// npm has already verified this exact bundle cryptographically. This function
// binds that proof to the release identity Sallyport expects.
export function verifyProvenanceBundle(input: ProvenanceBundleInput): string[] {
    const { expected } = input;
    const label = `${expected.packageName}@${expected.packageVersion}`;
    const { bundle } = input;
    const failures: string[] = [];
    failures.push(...certificateFailures(bundle, expected));
    const statement = decodeStatement(bundle);
    if (statement === null) {
        failures.push(`${UNRECOGNIZED}: the provenance payload could not be decoded for ${label}.`);
        return failures;
    }
    failures.push(...subjectFailures(statement, expected));
    failures.push(...buildFailures(statement, expected));
    return failures;
}

function decodeStatement(bundle: unknown): unknown {
    const payload = readStringProperty(readProperty(bundle, 'dsseEnvelope'), 'payload');
    if (payload === null) {
        return null;
    }
    try {
        return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as unknown;
    } catch {
        return null;
    }
}

function subjectFailures(statement: unknown, expected: ExpectedProvenance): string[] {
    const subjects = readArrayProperty(statement, 'subject');
    if (subjects === null || subjects.length === 0) {
        return [`${UNRECOGNIZED}: the provenance statement lists no subject.`];
    }
    const failures: string[] = [];
    const purl = `pkg:npm/${expected.packageName}@${expected.packageVersion}`.toLowerCase();
    const named = subjects.some(
        (subject) => decodeName(readStringProperty(subject, 'name')) === purl,
    );
    if (!named) {
        failures.push(`Provenance subject does not name ${purl}.`);
    }
    const digests = subjects
        .map((subject) => readStringProperty(readProperty(subject, 'digest'), 'sha512'))
        .filter((digest): digest is string => digest !== null);
    if (digests.length === 0) {
        failures.push(`${UNRECOGNIZED}: the provenance subject carries no sha512 digest.`);
    } else if (!digests.includes(expected.tarballSha512.toLowerCase())) {
        failures.push('Provenance subject digest does not match the candidate tarball.');
    }
    return failures;
}

function decodeName(value: string | null): string | null {
    if (value === null) {
        return null;
    }
    try {
        return decodeURIComponent(value).toLowerCase();
    } catch {
        return value.toLowerCase();
    }
}
