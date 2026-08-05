import {
    asRecord,
    checkBoolean,
    checkFingerprint,
    checkIntegrityMatchesDigest,
    checkKeys,
    checkLiteral,
    checkPattern,
    checkPositiveInteger,
    checkTagMatchesVersion,
    descriptions,
    nested,
    patterns,
} from './checks.ts';
import {
    CANDIDATE_TARBALL_FILENAME,
    PROTOCOL,
    RECEIPT_SCHEMA_VERSION,
} from './model.ts';

const ROOT_KEYS = ['schema', 'protocol', 'quoin', 'repository', 'source', 'package', 'tarball', 'run'];
const QUOIN_KEYS = ['version', 'workflow', 'sha'];
const REPOSITORY_KEYS = ['name', 'id', 'defaultBranch'];
const SOURCE_KEYS = ['tag', 'commit', 'signed', 'signerFingerprint'];
const PACKAGE_KEYS = ['name', 'version', 'access', 'distTag'];
const TARBALL_KEYS = ['filename', 'bytes', 'sha256', 'sha512', 'integrity'];
const RUN_KEYS = ['id', 'attempt'];

export function validateCandidateReceipt(value: unknown): string[] {
    const receipt = asRecord(value);
    if (receipt === null) {
        return ['candidate receipt must be a JSON object.'];
    }
    const failures: string[] = [];
    checkKeys(receipt, 'candidate receipt', ROOT_KEYS, failures);
    checkLiteral(receipt, '', 'schema', RECEIPT_SCHEMA_VERSION, failures);
    checkLiteral(receipt, '', 'protocol', PROTOCOL, failures);
    checkQuoin(receipt, failures);
    checkRepository(receipt, failures);
    const version = checkPackage(receipt, failures);
    checkSource(receipt, version, failures);
    checkTarball(receipt, failures);
    checkRun(receipt, failures);
    return failures;
}

function checkQuoin(receipt: Record<string, unknown>, failures: string[]): void {
    const fields = nested(receipt, '', 'quoin', QUOIN_KEYS, failures);
    if (fields === null) return;
    checkPattern(fields, 'quoin', 'version', patterns.semver, descriptions.semver, failures);
    checkPattern(
        fields,
        'quoin',
        'workflow',
        patterns.workflow,
        'an owner/name/.github/workflows/<file>.yml reference',
        failures,
    );
    checkPattern(fields, 'quoin', 'sha', patterns.commit, descriptions.commit, failures);
}

function checkRepository(receipt: Record<string, unknown>, failures: string[]): void {
    const fields = nested(receipt, '', 'repository', REPOSITORY_KEYS, failures);
    if (fields === null) return;
    checkPattern(fields, 'repository', 'name', patterns.repository, descriptions.repository, failures);
    checkPositiveInteger(fields, 'repository', 'id', failures);
    checkPattern(fields, 'repository', 'defaultBranch', patterns.branch, 'a Git branch name', failures);
}

function checkPackage(receipt: Record<string, unknown>, failures: string[]): string | null {
    const fields = nested(receipt, '', 'package', PACKAGE_KEYS, failures);
    if (fields === null) return null;
    checkPattern(fields, 'package', 'name', patterns.packageName, 'a valid npm package name', failures);
    const version = checkPattern(
        fields,
        'package',
        'version',
        patterns.semver,
        descriptions.semver,
        failures,
    );
    checkLiteral(fields, 'package', 'access', 'public', failures);
    checkPattern(fields, 'package', 'distTag', patterns.distTag, 'a nonnumeric npm dist-tag', failures);
    return version;
}

function checkSource(
    receipt: Record<string, unknown>,
    version: string | null,
    failures: string[],
): void {
    const fields = nested(receipt, '', 'source', SOURCE_KEYS, failures);
    if (fields === null) return;
    const tag = checkPattern(fields, 'source', 'tag', patterns.releaseTag, descriptions.tag, failures);
    checkPattern(fields, 'source', 'commit', patterns.commit, descriptions.commit, failures);
    const signed = checkBoolean(fields, 'source', 'signed', failures);
    checkFingerprint(fields, signed, failures);
    checkTagMatchesVersion(tag, version, failures);
}

function checkTarball(receipt: Record<string, unknown>, failures: string[]): void {
    const fields = nested(receipt, '', 'tarball', TARBALL_KEYS, failures);
    if (fields === null) return;
    checkLiteral(fields, 'tarball', 'filename', CANDIDATE_TARBALL_FILENAME, failures);
    checkPositiveInteger(fields, 'tarball', 'bytes', failures);
    checkPattern(fields, 'tarball', 'sha256', patterns.sha256, descriptions.sha256, failures);
    const sha512 = checkPattern(
        fields,
        'tarball',
        'sha512',
        patterns.sha512,
        descriptions.sha512,
        failures,
    );
    const integrity = checkPattern(
        fields,
        'tarball',
        'integrity',
        patterns.integrity,
        'an sha512- prefixed base64 npm integrity value',
        failures,
    );
    checkIntegrityMatchesDigest(integrity, sha512, failures);
}

function checkRun(receipt: Record<string, unknown>, failures: string[]): void {
    const fields = nested(receipt, '', 'run', RUN_KEYS, failures);
    if (fields === null) return;
    checkPositiveInteger(fields, 'run', 'id', failures);
    checkPositiveInteger(fields, 'run', 'attempt', failures);
}
