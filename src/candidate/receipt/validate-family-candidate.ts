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
    type Fields,
} from './checks.ts';
import {
    candidateTarballFilename,
    FAMILY_PROTOCOL,
    FAMILY_SCHEMA_VERSION,
} from './family-model.ts';
const ROOT = ['schema', 'protocol', 'sallyport', 'repository', 'source', 'family', 'packages', 'run'];
const DIRECTORY = /^(?!\.{1,2}(?:\/|$))(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u;
export function validateFamilyCandidateReceipt(value: unknown): string[] {
    const receipt = asRecord(value);
    if (receipt === null) return ['family candidate receipt must be a JSON object.'];
    const failures: string[] = [];
    checkKeys(receipt, 'family candidate receipt', ROOT, failures);
    checkLiteral(receipt, '', 'schema', FAMILY_SCHEMA_VERSION, failures);
    checkLiteral(receipt, '', 'protocol', FAMILY_PROTOCOL, failures);
    checkSallyport(receipt, failures);
    checkRepository(receipt, failures);
    const family = checkFamily(receipt, failures);
    checkSource(receipt, family.version, failures);
    checkPackages(receipt, family, failures);
    checkRun(receipt, failures);
    return failures;
}

function checkSallyport(receipt: Fields, failures: string[]): void {
    const fields = nested(receipt, '', 'sallyport', ['version', 'workflow', 'sha'], failures);
    if (fields === null) return;
    checkPattern(fields, 'sallyport', 'version', patterns.semver, descriptions.semver, failures);
    checkPattern(fields, 'sallyport', 'workflow', patterns.workflow, 'a workflow reference', failures);
    checkPattern(fields, 'sallyport', 'sha', patterns.commit, descriptions.commit, failures);
}

function checkRepository(receipt: Fields, failures: string[]): void {
    const fields = nested(receipt, '', 'repository', ['name', 'id', 'defaultBranch'], failures);
    if (fields === null) return;
    checkPattern(fields, 'repository', 'name', patterns.repository, descriptions.repository, failures);
    checkPositiveInteger(fields, 'repository', 'id', failures);
    checkPattern(fields, 'repository', 'defaultBranch', patterns.branch, 'a Git branch name', failures);
}

function checkFamily(
    receipt: Fields,
    failures: string[],
): { version: string | null; distTag: string | null } {
    const fields = nested(receipt, '', 'family', ['name', 'version', 'distTag'], failures);
    if (fields === null) return { version: null, distTag: null };
    checkPattern(fields, 'family', 'name', patterns.packageName, 'a valid npm package name', failures);
    const version = checkPattern(
        fields, 'family', 'version', patterns.semver, descriptions.semver, failures,
    );
    const distTag = checkPattern(
        fields, 'family', 'distTag', patterns.distTag, 'a nonnumeric npm dist-tag', failures,
    );
    return { version, distTag };
}

function checkSource(receipt: Fields, version: string | null, failures: string[]): void {
    const fields = nested(
        receipt, '', 'source',
        ['tag', 'tagObject', 'commit', 'signed', 'signerFingerprint'],
        failures,
    );
    if (fields === null) return;
    const tag = checkPattern(fields, 'source', 'tag', patterns.releaseTag, descriptions.tag, failures);
    checkPattern(fields, 'source', 'tagObject', patterns.commit, descriptions.commit, failures);
    checkPattern(fields, 'source', 'commit', patterns.commit, descriptions.commit, failures);
    const signed = checkBoolean(fields, 'source', 'signed', failures);
    checkFingerprint(fields, signed, failures);
    checkTagMatchesVersion(tag, version, failures);
}

function checkPackages(
    receipt: Fields,
    family: { version: string | null; distTag: string | null },
    failures: string[],
): void {
    const packages = receipt.packages;
    if (!Array.isArray(packages) || packages.length < 2) {
        failures.push('packages must contain at least two members.');
        return;
    }
    const names: Set<string> = new Set();
    const directories: Set<string> = new Set();
    for (const [index, value] of packages.entries()) {
        const label = 'packages[' + String(index) + ']';
        const member = asRecord(value);
        if (member === null) {
            failures.push(label + ' must be a JSON object.');
            continue;
        }
        checkKeys(member, label, ['directory', 'name', 'version', 'access', 'distTag', 'tarball'], failures);
        const directory = checkPattern(member, label, 'directory', DIRECTORY, 'a safe relative directory', failures);
        const name = checkPattern(member, label, 'name', patterns.packageName, 'a valid npm package name', failures);
        const version = checkPattern(member, label, 'version', patterns.semver, descriptions.semver, failures);
        const distTag = checkPattern(member, label, 'distTag', patterns.distTag, 'a valid npm dist-tag', failures);
        checkLiteral(member, label, 'access', 'public', failures);
        if (version !== null && family.version !== null && version !== family.version) {
            failures.push(label + '.version must equal family.version.');
        }
        if (distTag !== null && family.distTag !== null && distTag !== family.distTag) {
            failures.push(label + '.distTag must equal family.distTag.');
        }
        checkUnique(name, names, label + '.name', failures);
        checkUnique(directory, directories, label + '.directory', failures);
        checkTarball(member, label, candidateTarballFilename(index, packages.length), failures);
    }
}

function checkTarball(member: Fields, label: string, filename: string, failures: string[]): void {
    const fields = nested(member, label, 'tarball', ['filename', 'bytes', 'sha256', 'sha512', 'integrity'], failures);
    if (fields === null) return;
    checkLiteral(fields, label + '.tarball', 'filename', filename, failures);
    checkPositiveInteger(fields, label + '.tarball', 'bytes', failures);
    checkPattern(fields, label + '.tarball', 'sha256', patterns.sha256, descriptions.sha256, failures);
    const sha512 = checkPattern(fields, label + '.tarball', 'sha512', patterns.sha512, descriptions.sha512, failures);
    const integrity = checkPattern(fields, label + '.tarball', 'integrity', patterns.integrity, 'a sha512 SRI value', failures);
    checkIntegrityMatchesDigest(integrity, sha512, failures);
}

function checkRun(receipt: Fields, failures: string[]): void {
    const fields = nested(receipt, '', 'run', ['id', 'attempt'], failures);
    if (fields === null) return;
    checkPositiveInteger(fields, 'run', 'id', failures);
    checkPositiveInteger(fields, 'run', 'attempt', failures);
}

function checkUnique(
    value: string | null,
    seen: Set<string>,
    label: string,
    failures: string[],
): void {
    if (value === null) return;
    if (seen.has(value)) failures.push(label + ' must be unique.');
    seen.add(value);
}
