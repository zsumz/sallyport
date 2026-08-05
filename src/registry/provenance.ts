import { Buffer } from 'node:buffer';
import type { CommandOptions, CommandResult } from '../report/exec.ts';
import {
    attestationsUrl,
    errorMessage,
    readArrayProperty,
    readProperty,
    readStringProperty,
    type FetchJson,
} from './download.ts';

export type CommandRunner = (
    command: string,
    args: readonly string[],
    options: CommandOptions,
) => CommandResult;

export interface ExpectedProvenance {
    packageName: string;
    packageVersion: string;
    repository: string;
    workflowPath: string;
    tagRef: string;
    tarballSha512: string;
    runId?: number;
}

export interface ProvenanceIdentityInput {
    attestations: unknown;
    expected: ExpectedProvenance;
}

export interface AuditSignaturesInput {
    exec: CommandRunner;
    installDir: string;
    cacheDir?: string;
}

export type AuditOutcome =
    | { ok: true; report: unknown }
    | { ok: false; failures: string[] };

export interface ProvenanceVerificationInput {
    exec: CommandRunner;
    fetchJson: FetchJson;
    installDir: string;
    registry: string;
    expected: ExpectedProvenance;
    cacheDir?: string;
}

export type ProvenanceResult =
    | { ok: true }
    | { ok: false; failures: string[] };

const UNRECOGNIZED = 'attestation format not recognized';
const PROVENANCE_PREDICATE = 'slsa.dev/provenance';

export function runAuditSignatures(input: AuditSignaturesInput): AuditOutcome {
    const args = [
        'audit',
        'signatures',
        '--include-attestations',
        '--json',
    ];
    if (input.cacheDir !== undefined) {
        args.push('--cache', input.cacheDir);
    }
    let result: CommandResult;
    try {
        result = input.exec('npm', args, { cwd: input.installDir });
    } catch (error) {
        return { ok: false, failures: [`npm audit signatures failed: ${errorMessage(error)}`] };
    }
    try {
        return { ok: true, report: JSON.parse(result.stdout) as unknown };
    } catch {
        return {
            ok: false,
            failures: [`${UNRECOGNIZED}: npm audit signatures did not emit JSON.`],
        };
    }
}

export function verifyAuditSignatures(
    report: unknown,
    expected: ExpectedProvenance,
): string[] {
    const label = `${expected.packageName}@${expected.packageVersion}`;
    if (typeof report !== 'object' || report === null) {
        return [`${UNRECOGNIZED}: npm audit signatures output was not an object.`];
    }
    const failures: string[] = [];
    failures.push(...unverifiedFailures(report, 'invalid'));
    failures.push(...unverifiedFailures(report, 'missing'));
    const verified = readArrayProperty(report, 'verified');
    if (verified === null) {
        failures.push(`${UNRECOGNIZED}: npm audit signatures reported no verified list.`);
        return failures;
    }
    const entry = verified.find(
        (value) => readStringProperty(value, 'name') === expected.packageName
            && readStringProperty(value, 'version') === expected.packageVersion,
    );
    if (entry === undefined) {
        failures.push(`npm did not verify the registry signature for ${label}.`);
        return failures;
    }
    const provenance = readProperty(readProperty(entry, 'attestations'), 'provenance');
    if (typeof provenance !== 'object' || provenance === null) {
        failures.push(`npm did not verify a provenance attestation for ${label}.`);
    }
    return failures;
}

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

export async function fetchAttestations(
    fetchJson: FetchJson,
    registry: string,
    packageName: string,
    version: string,
): Promise<unknown> {
    const url = attestationsUrl(registry, packageName, version);
    const response = await fetchJson(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        body: null,
    });
    if (response.status === 404) {
        return null;
    }
    if (response.status !== 200) {
        throw new Error(`Registry request failed: ${url} returned ${String(response.status)}.`);
    }
    return response.body;
}

export async function verifyRegistryProvenance(
    input: ProvenanceVerificationInput,
): Promise<ProvenanceResult> {
    const { expected } = input;
    const failures: string[] = [];
    const audit = runAuditSignatures({
        exec: input.exec,
        installDir: input.installDir,
        ...input.cacheDir === undefined ? {} : { cacheDir: input.cacheDir },
    });
    if (audit.ok) {
        failures.push(...verifyAuditSignatures(audit.report, expected));
    } else {
        failures.push(...audit.failures);
    }
    try {
        const attestations = await fetchAttestations(
            input.fetchJson,
            input.registry,
            expected.packageName,
            expected.packageVersion,
        );
        failures.push(...verifyProvenanceIdentity({ attestations, expected }));
    } catch (error) {
        failures.push(`Attestation download failed: ${errorMessage(error)}`);
    }
    if (failures.length > 0) {
        return { ok: false, failures };
    }
    return { ok: true };
}

function unverifiedFailures(report: unknown, key: string): string[] {
    const entries = readArrayProperty(report, key);
    if (entries === null || entries.length === 0) {
        return [];
    }
    return [`npm reported ${String(entries.length)} ${key} package signatures.`];
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
    if (chain === null || chain.length === 0) {
        return false;
    }
    return readStringProperty(chain[0], 'rawBytes') !== null;
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

interface BuildIdentity {
    repository: string | null;
    workflowPath: string | null;
    ref: string | null;
}

function buildFailures(statement: unknown, expected: ExpectedProvenance): string[] {
    const predicate = readProperty(statement, 'predicate');
    const identity = slsaV1Identity(predicate) ?? slsaV02Identity(predicate);
    if (identity === null) {
        return [`${UNRECOGNIZED}: the provenance predicate has no build definition.`];
    }
    const failures: string[] = [];
    const expectedRepository = normalizeRepository(expected.repository);
    if (expectedRepository === null) {
        failures.push(`Expected repository ${expected.repository} is not an owner/name pair.`);
    } else if (identity.repository === null) {
        failures.push(`${UNRECOGNIZED}: the provenance predicate names no source repository.`);
    } else if (identity.repository !== expectedRepository) {
        failures.push(
            `Provenance repository ${identity.repository} does not match ${expected.repository}.`,
        );
    }
    if (identity.workflowPath === null) {
        failures.push(`${UNRECOGNIZED}: the provenance predicate names no workflow.`);
    } else if (identity.workflowPath !== expected.workflowPath) {
        failures.push(
            `Provenance workflow ${identity.workflowPath} does not match ${expected.workflowPath}.`,
        );
    }
    const expectedRef = normalizeTagRef(expected.tagRef);
    if (identity.ref === null) {
        failures.push(`${UNRECOGNIZED}: the provenance predicate names no source ref.`);
    } else if (normalizeTagRef(identity.ref) !== expectedRef) {
        failures.push(`Provenance ref ${identity.ref} does not match ${expectedRef}.`);
    }
    failures.push(...runFailures(predicate, expected));
    return failures;
}

function runFailures(predicate: unknown, expected: ExpectedProvenance): string[] {
    if (expected.runId === undefined) {
        return [];
    }
    const invocation = readStringProperty(
        readProperty(readProperty(predicate, 'runDetails'), 'metadata'),
        'invocationId',
    );
    if (invocation === null) {
        return [`${UNRECOGNIZED}: the provenance predicate names no workflow run.`];
    }
    if (!invocation.includes(`/actions/runs/${String(expected.runId)}/`)) {
        return [`Provenance run ${invocation} does not identify run ${String(expected.runId)}.`];
    }
    return [];
}

function slsaV1Identity(predicate: unknown): BuildIdentity | null {
    const workflow = readProperty(
        readProperty(readProperty(predicate, 'buildDefinition'), 'externalParameters'),
        'workflow',
    );
    if (typeof workflow !== 'object' || workflow === null) {
        return null;
    }
    const repository = readStringProperty(workflow, 'repository');
    return {
        repository: repository === null ? null : normalizeRepository(repository),
        workflowPath: readStringProperty(workflow, 'path'),
        ref: readStringProperty(workflow, 'ref'),
    };
}

function slsaV02Identity(predicate: unknown): BuildIdentity | null {
    const configSource = readProperty(readProperty(predicate, 'invocation'), 'configSource');
    if (typeof configSource !== 'object' || configSource === null) {
        return null;
    }
    const uri = readStringProperty(configSource, 'uri');
    const source = uri === null ? null : splitSourceUri(uri);
    return {
        repository: source === null ? null : normalizeRepository(source.repository),
        workflowPath: readStringProperty(configSource, 'entryPoint'),
        ref: source?.ref ?? null,
    };
}

function splitSourceUri(uri: string): { repository: string; ref: string | null } {
    const separator = uri.lastIndexOf('@');
    if (separator <= 0) {
        return { repository: uri, ref: null };
    }
    return {
        repository: uri.slice(0, separator),
        ref: uri.slice(separator + 1),
    };
}

// Duplicated from the contract area on purpose: src/registry must not depend on
// src/contract. The integrator may swap this for normalizeRepositoryUrl.
function normalizeRepository(value: string): string | null {
    let text = value.trim();
    if (text.startsWith('git+')) {
        text = text.slice(4);
    }
    text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    text = text.replace(/^[^/@]+@/, '');
    text = text.replace(/^github\.com[:/]/i, '');
    if (text.endsWith('.git')) {
        text = text.slice(0, -4);
    }
    if (text.endsWith('/')) {
        text = text.slice(0, -1);
    }
    return /^[^/\s]+\/[^/\s]+$/.test(text) ? text.toLowerCase() : null;
}

function normalizeTagRef(value: string): string {
    return value.startsWith('refs/') ? value : `refs/tags/${value}`;
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
