export const PROTOCOL = 'quoin/0.1';
export const RECEIPT_SCHEMA_VERSION = 1;
export const CANDIDATE_TARBALL_FILENAME = 'package.tgz';

export interface CandidateReceipt {
    schema: number;
    protocol: string;
    quoin: {
        version: string;
        workflow: string;
        sha: string;
    };
    repository: {
        name: string;
        id: number;
        defaultBranch: string;
    };
    source: {
        tag: string;
        commit: string;
        signed: boolean;
        signerFingerprint: string | null;
    };
    package: {
        name: string;
        version: string;
        access: 'public';
        distTag: string;
    };
    tarball: {
        filename: string;
        bytes: number;
        sha256: string;
        sha512: string;
        integrity: string;
    };
    run: {
        id: number;
        attempt: number;
    };
}

export interface ReleaseRecord {
    schema: number;
    protocol: string;
    candidateReceiptSha256: string;
    package: {
        name: string;
        version: string;
        distTag: string;
    };
    candidate: {
        sha256: string;
        sha512: string;
    };
    registry: {
        sha256: string;
        sha512: string;
        integrityVerified: boolean;
        signatureVerified: boolean;
        provenanceVerified: boolean;
    };
    source: {
        repository: string;
        tag: string;
        commit: string;
    };
}

export interface CandidateReceiptParts {
    quoin: CandidateReceipt['quoin'];
    repository: CandidateReceipt['repository'];
    source: CandidateReceipt['source'];
    package: Omit<CandidateReceipt['package'], 'access'>;
    tarball: Omit<CandidateReceipt['tarball'], 'filename'>;
    run: CandidateReceipt['run'];
}

export interface ReleaseRecordParts {
    candidateReceiptSha256: string;
    package: ReleaseRecord['package'];
    candidate: ReleaseRecord['candidate'];
    registry: ReleaseRecord['registry'];
    source: ReleaseRecord['source'];
}

type Fields = Record<string, unknown>;

const SEMVER_BODY = '(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)'
    + '(?:-(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)'
    + '(?:\\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*)?'
    + '(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?';
const SEMVER_PATTERN = new RegExp(`^${SEMVER_BODY}$`);
const RELEASE_TAG_PATTERN = new RegExp(`^v${SEMVER_BODY}$`);
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SHA512_PATTERN = /^[0-9a-f]{128}$/;
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]{86}==$/;
const FINGERPRINT_PATTERN = /^[0-9A-F]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;
const WORKFLOW_PATTERN =
    /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+\/\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const DIST_TAG_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

const CANDIDATE_KEYS = [
    'schema',
    'protocol',
    'quoin',
    'repository',
    'source',
    'package',
    'tarball',
    'run',
];
const QUOIN_KEYS = ['version', 'workflow', 'sha'];
const REPOSITORY_KEYS = ['name', 'id', 'defaultBranch'];
const SOURCE_KEYS = ['tag', 'commit', 'signed', 'signerFingerprint'];
const PACKAGE_KEYS = ['name', 'version', 'access', 'distTag'];
const TARBALL_KEYS = ['filename', 'bytes', 'sha256', 'sha512', 'integrity'];
const RUN_KEYS = ['id', 'attempt'];
const RELEASE_KEYS = [
    'schema',
    'protocol',
    'candidateReceiptSha256',
    'package',
    'candidate',
    'registry',
    'source',
];
const RELEASE_PACKAGE_KEYS = ['name', 'version', 'distTag'];
const RELEASE_CANDIDATE_KEYS = ['sha256', 'sha512'];
const RELEASE_REGISTRY_KEYS = [
    'sha256',
    'sha512',
    'integrityVerified',
    'signatureVerified',
    'provenanceVerified',
];
const RELEASE_SOURCE_KEYS = ['repository', 'tag', 'commit'];

const COMMIT_DESCRIPTION = 'a 40-character lowercase hexadecimal commit SHA';
const SHA256_DESCRIPTION = 'a 64-character lowercase hexadecimal SHA-256 digest';
const SHA512_DESCRIPTION = 'a 128-character lowercase hexadecimal SHA-512 digest';
const SEMVER_DESCRIPTION = 'a valid SemVer version';
const TAG_DESCRIPTION = 'a v<version> release tag';
const REPOSITORY_DESCRIPTION = 'an owner/name GitHub repository';

// Release metadata is derived, never supplied: access, filename, schema and protocol are fixed.
export function buildCandidateReceipt(parts: CandidateReceiptParts): CandidateReceipt {
    const receipt: CandidateReceipt = {
        schema: RECEIPT_SCHEMA_VERSION,
        protocol: PROTOCOL,
        quoin: {
            version: parts.quoin.version,
            workflow: parts.quoin.workflow,
            sha: parts.quoin.sha,
        },
        repository: {
            name: parts.repository.name,
            id: parts.repository.id,
            defaultBranch: parts.repository.defaultBranch,
        },
        source: {
            tag: parts.source.tag,
            commit: parts.source.commit,
            signed: parts.source.signed,
            signerFingerprint: parts.source.signerFingerprint,
        },
        package: {
            name: parts.package.name,
            version: parts.package.version,
            access: 'public',
            distTag: parts.package.distTag,
        },
        tarball: {
            filename: CANDIDATE_TARBALL_FILENAME,
            bytes: parts.tarball.bytes,
            sha256: parts.tarball.sha256,
            sha512: parts.tarball.sha512,
            integrity: parts.tarball.integrity,
        },
        run: {
            id: parts.run.id,
            attempt: parts.run.attempt,
        },
    };
    const failures = validateCandidateReceipt(receipt);
    if (failures.length > 0) {
        throw new Error(`Candidate receipt is invalid:\n${failures.join('\n')}`);
    }
    return receipt;
}

export function buildReleaseRecord(parts: ReleaseRecordParts): ReleaseRecord {
    const record: ReleaseRecord = {
        schema: RECEIPT_SCHEMA_VERSION,
        protocol: PROTOCOL,
        candidateReceiptSha256: parts.candidateReceiptSha256,
        package: {
            name: parts.package.name,
            version: parts.package.version,
            distTag: parts.package.distTag,
        },
        candidate: {
            sha256: parts.candidate.sha256,
            sha512: parts.candidate.sha512,
        },
        registry: {
            sha256: parts.registry.sha256,
            sha512: parts.registry.sha512,
            integrityVerified: parts.registry.integrityVerified,
            signatureVerified: parts.registry.signatureVerified,
            provenanceVerified: parts.registry.provenanceVerified,
        },
        source: {
            repository: parts.source.repository,
            tag: parts.source.tag,
            commit: parts.source.commit,
        },
    };
    const failures = validateReleaseRecord(record);
    if (failures.length > 0) {
        throw new Error(`Release record is invalid:\n${failures.join('\n')}`);
    }
    return record;
}

export function validateCandidateReceipt(value: unknown): string[] {
    const receipt = asRecord(value);
    if (receipt === null) {
        return ['candidate receipt must be a JSON object.'];
    }
    const failures: string[] = [];
    checkKeys(receipt, 'candidate receipt', CANDIDATE_KEYS, failures);
    checkLiteral(receipt, '', 'schema', RECEIPT_SCHEMA_VERSION, failures);
    checkLiteral(receipt, '', 'protocol', PROTOCOL, failures);

    const quoin = nested(receipt, '', 'quoin', QUOIN_KEYS, failures);
    if (quoin !== null) {
        checkPattern(quoin, 'quoin', 'version', SEMVER_PATTERN, SEMVER_DESCRIPTION, failures);
        checkPattern(
            quoin,
            'quoin',
            'workflow',
            WORKFLOW_PATTERN,
            'an owner/name/.github/workflows/<file>.yml reference',
            failures,
        );
        checkPattern(quoin, 'quoin', 'sha', COMMIT_PATTERN, COMMIT_DESCRIPTION, failures);
    }

    const repository = nested(receipt, '', 'repository', REPOSITORY_KEYS, failures);
    if (repository !== null) {
        checkPattern(
            repository,
            'repository',
            'name',
            REPOSITORY_PATTERN,
            REPOSITORY_DESCRIPTION,
            failures,
        );
        checkPositiveInteger(repository, 'repository', 'id', failures);
        checkPattern(
            repository,
            'repository',
            'defaultBranch',
            BRANCH_PATTERN,
            'a Git branch name',
            failures,
        );
    }

    const packageFields = nested(receipt, '', 'package', PACKAGE_KEYS, failures);
    let version: string | null = null;
    if (packageFields !== null) {
        checkPattern(
            packageFields,
            'package',
            'name',
            PACKAGE_NAME_PATTERN,
            'a valid npm package name',
            failures,
        );
        version = checkPattern(
            packageFields,
            'package',
            'version',
            SEMVER_PATTERN,
            SEMVER_DESCRIPTION,
            failures,
        );
        checkLiteral(packageFields, 'package', 'access', 'public', failures);
        checkPattern(
            packageFields,
            'package',
            'distTag',
            DIST_TAG_PATTERN,
            'a nonnumeric npm dist-tag',
            failures,
        );
    }

    const source = nested(receipt, '', 'source', SOURCE_KEYS, failures);
    if (source !== null) {
        const tag = checkPattern(
            source,
            'source',
            'tag',
            RELEASE_TAG_PATTERN,
            TAG_DESCRIPTION,
            failures,
        );
        checkPattern(source, 'source', 'commit', COMMIT_PATTERN, COMMIT_DESCRIPTION, failures);
        const signed = checkBoolean(source, 'source', 'signed', failures);
        checkFingerprint(source, signed, failures);
        checkTagMatchesVersion(tag, version, failures);
    }

    const tarball = nested(receipt, '', 'tarball', TARBALL_KEYS, failures);
    if (tarball !== null) {
        checkLiteral(tarball, 'tarball', 'filename', CANDIDATE_TARBALL_FILENAME, failures);
        checkPositiveInteger(tarball, 'tarball', 'bytes', failures);
        checkPattern(tarball, 'tarball', 'sha256', SHA256_PATTERN, SHA256_DESCRIPTION, failures);
        const sha512 = checkPattern(
            tarball,
            'tarball',
            'sha512',
            SHA512_PATTERN,
            SHA512_DESCRIPTION,
            failures,
        );
        const integrity = checkPattern(
            tarball,
            'tarball',
            'integrity',
            INTEGRITY_PATTERN,
            'an sha512- prefixed base64 npm integrity value',
            failures,
        );
        checkIntegrityMatchesDigest(integrity, sha512, failures);
    }

    const run = nested(receipt, '', 'run', RUN_KEYS, failures);
    if (run !== null) {
        checkPositiveInteger(run, 'run', 'id', failures);
        checkPositiveInteger(run, 'run', 'attempt', failures);
    }
    return failures;
}

export function validateReleaseRecord(value: unknown): string[] {
    const record = asRecord(value);
    if (record === null) {
        return ['release record must be a JSON object.'];
    }
    const failures: string[] = [];
    checkKeys(record, 'release record', RELEASE_KEYS, failures);
    checkLiteral(record, '', 'schema', RECEIPT_SCHEMA_VERSION, failures);
    checkLiteral(record, '', 'protocol', PROTOCOL, failures);
    checkPattern(
        record,
        '',
        'candidateReceiptSha256',
        SHA256_PATTERN,
        SHA256_DESCRIPTION,
        failures,
    );

    const packageFields = nested(record, '', 'package', RELEASE_PACKAGE_KEYS, failures);
    let version: string | null = null;
    if (packageFields !== null) {
        checkPattern(
            packageFields,
            'package',
            'name',
            PACKAGE_NAME_PATTERN,
            'a valid npm package name',
            failures,
        );
        version = checkPattern(
            packageFields,
            'package',
            'version',
            SEMVER_PATTERN,
            SEMVER_DESCRIPTION,
            failures,
        );
        checkPattern(
            packageFields,
            'package',
            'distTag',
            DIST_TAG_PATTERN,
            'a nonnumeric npm dist-tag',
            failures,
        );
    }

    const candidate = nested(record, '', 'candidate', RELEASE_CANDIDATE_KEYS, failures);
    let candidateSha256: string | null = null;
    let candidateSha512: string | null = null;
    if (candidate !== null) {
        candidateSha256 = checkPattern(
            candidate,
            'candidate',
            'sha256',
            SHA256_PATTERN,
            SHA256_DESCRIPTION,
            failures,
        );
        candidateSha512 = checkPattern(
            candidate,
            'candidate',
            'sha512',
            SHA512_PATTERN,
            SHA512_DESCRIPTION,
            failures,
        );
    }

    const registry = nested(record, '', 'registry', RELEASE_REGISTRY_KEYS, failures);
    if (registry !== null) {
        const registrySha256 = checkPattern(
            registry,
            'registry',
            'sha256',
            SHA256_PATTERN,
            SHA256_DESCRIPTION,
            failures,
        );
        const registrySha512 = checkPattern(
            registry,
            'registry',
            'sha512',
            SHA512_PATTERN,
            SHA512_DESCRIPTION,
            failures,
        );
        checkLiteral(registry, 'registry', 'integrityVerified', true, failures);
        checkLiteral(registry, 'registry', 'signatureVerified', true, failures);
        checkLiteral(registry, 'registry', 'provenanceVerified', true, failures);
        checkPublicBytesMatch('sha256', candidateSha256, registrySha256, failures);
        checkPublicBytesMatch('sha512', candidateSha512, registrySha512, failures);
    }

    const source = nested(record, '', 'source', RELEASE_SOURCE_KEYS, failures);
    if (source !== null) {
        checkPattern(
            source,
            'source',
            'repository',
            REPOSITORY_PATTERN,
            REPOSITORY_DESCRIPTION,
            failures,
        );
        const tag = checkPattern(
            source,
            'source',
            'tag',
            RELEASE_TAG_PATTERN,
            TAG_DESCRIPTION,
            failures,
        );
        checkPattern(source, 'source', 'commit', COMMIT_PATTERN, COMMIT_DESCRIPTION, failures);
        checkTagMatchesVersion(tag, version, failures);
    }
    return failures;
}

function asRecord(value: unknown): Fields | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Fields
        : null;
}

function fieldPath(parent: string, key: string): string {
    return parent === '' ? key : `${parent}.${key}`;
}

function checkKeys(
    fields: Fields,
    label: string,
    allowed: readonly string[],
    failures: string[],
): void {
    for (const key of Object.keys(fields)) {
        if (!allowed.includes(key)) {
            failures.push(`${label} has an unknown property "${key}".`);
        }
    }
}

function nested(
    fields: Fields,
    parent: string,
    key: string,
    allowed: readonly string[],
    failures: string[],
): Fields | null {
    const path = fieldPath(parent, key);
    const value = asRecord(fields[key]);
    if (value === null) {
        failures.push(`${path} must be a JSON object.`);
        return null;
    }
    checkKeys(value, path, allowed, failures);
    return value;
}

function checkPattern(
    fields: Fields,
    parent: string,
    key: string,
    pattern: RegExp,
    description: string,
    failures: string[],
): string | null {
    const value = fields[key];
    if (typeof value !== 'string' || !pattern.test(value)) {
        failures.push(`${fieldPath(parent, key)} must be ${description}.`);
        return null;
    }
    return value;
}

function checkLiteral(
    fields: Fields,
    parent: string,
    key: string,
    expected: string | number | boolean,
    failures: string[],
): void {
    if (fields[key] !== expected) {
        failures.push(`${fieldPath(parent, key)} must be ${JSON.stringify(expected)}.`);
    }
}

function checkBoolean(
    fields: Fields,
    parent: string,
    key: string,
    failures: string[],
): boolean | null {
    const value = fields[key];
    if (typeof value !== 'boolean') {
        failures.push(`${fieldPath(parent, key)} must be a boolean.`);
        return null;
    }
    return value;
}

function checkPositiveInteger(
    fields: Fields,
    parent: string,
    key: string,
    failures: string[],
): void {
    const value = fields[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        failures.push(`${fieldPath(parent, key)} must be a positive integer.`);
    }
}

function checkFingerprint(source: Fields, signed: boolean | null, failures: string[]): void {
    const value = source.signerFingerprint;
    if (value === null) {
        if (signed === true) {
            failures.push(
                'source.signerFingerprint must be a 40-character uppercase hexadecimal'
                + ' fingerprint when source.signed is true.',
            );
        }
        return;
    }
    if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) {
        failures.push(
            'source.signerFingerprint must be a 40-character uppercase hexadecimal'
            + ' fingerprint or null.',
        );
        return;
    }
    if (signed === false) {
        failures.push('source.signerFingerprint must be null when source.signed is false.');
    }
}

function checkTagMatchesVersion(
    tag: string | null,
    version: string | null,
    failures: string[],
): void {
    if (tag === null || version === null) {
        return;
    }
    if (tag !== `v${version}`) {
        failures.push(`source.tag must be "v${version}" to match package.version.`);
    }
}

function checkIntegrityMatchesDigest(
    integrity: string | null,
    sha512: string | null,
    failures: string[],
): void {
    if (integrity === null || sha512 === null) {
        return;
    }
    const expected = `sha512-${Buffer.from(sha512, 'hex').toString('base64')}`;
    if (integrity !== expected) {
        failures.push('tarball.integrity must be the base64 SRI form of tarball.sha512.');
    }
}

// One authoritative tarball: the public bytes must equal the staged candidate bytes.
function checkPublicBytesMatch(
    algorithm: string,
    candidate: string | null,
    registry: string | null,
    failures: string[],
): void {
    if (candidate === null || registry === null) {
        return;
    }
    if (candidate !== registry) {
        failures.push(`registry.${algorithm} must equal candidate.${algorithm}.`);
    }
}
