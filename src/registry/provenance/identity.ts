import { Buffer } from 'node:buffer';

import { readArrayProperty, readProperty, readStringProperty } from '../download.ts';
import { buildFailures } from './predicate.ts';
import {
    UNRECOGNIZED,
    type ExpectedProvenance,
    type ProvenanceIdentityInput,
} from './model.ts';

const PROVENANCE_PREDICATE = 'slsa.dev/provenance';

// Pure identity check over the already-fetched registry attestations document.
export function verifyProvenanceIdentity(input: ProvenanceIdentityInput): string[] {
    const { expected } = input;
    const label = `${expected.packageName}@${expected.packageVersion}`;
    const entries = attestationEntries(input.attestations);
    if (entries === null) {
        return [`${UNRECOGNIZED}: no attestation list for ${label}.`];
    }
    if (entries.length === 0) {
        return [`No attestations are published for ${label}.`];
    }
    const provenance = entries.find(
        (entry) => readStringProperty(entry, 'predicateType')?.includes(PROVENANCE_PREDICATE) === true,
    );
    if (provenance === undefined) {
        return [`No SLSA provenance attestation is published for ${label}.`];
    }
    const bundle = readProperty(provenance, 'bundle');
    const failures: string[] = [];
    if (!hasSigningCertificate(bundle)) {
        failures.push(`${UNRECOGNIZED}: the provenance bundle carries no signing certificate.`);
    }
    const statement = decodeStatement(bundle);
    if (statement === null) {
        failures.push(`${UNRECOGNIZED}: the provenance payload could not be decoded for ${label}.`);
        return failures;
    }
    failures.push(...subjectFailures(statement, expected));
    failures.push(...buildFailures(statement, expected));
    return failures;
}

function attestationEntries(value: unknown): unknown[] | null {
    if (Array.isArray(value)) {
        return value as unknown[];
    }
    return readArrayProperty(value, 'attestations');
}

function hasSigningCertificate(bundle: unknown): boolean {
    const material = readProperty(bundle, 'verificationMaterial');
    if (readStringProperty(readProperty(material, 'certificate'), 'rawBytes') !== null) {
        return true;
    }
    const chain = readArrayProperty(
        readProperty(material, 'x509CertificateChain'),
        'certificates',
    );
    return chain !== null
        && chain.length > 0
        && readStringProperty(chain[0], 'rawBytes') !== null;
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
