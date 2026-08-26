import {
    asRecord,
    checkKeys,
    checkLiteral,
    checkPattern,
    checkPublicBytesMatch,
    checkTagMatchesVersion,
    descriptions,
    nested,
    patterns,
    type Fields,
} from './checks.ts';
import { FAMILY_PROTOCOL, FAMILY_SCHEMA_VERSION } from './family-model.ts';

const ROOT = [
    'schema',
    'protocol',
    'candidateReceiptSha256',
    'releaseNotesSha256',
    'family',
    'packages',
    'source',
];

export function validateFamilyReleaseRecord(value: unknown): string[] {
    const record = asRecord(value);
    if (record === null) return ['family release record must be a JSON object.'];
    const failures: string[] = [];
    checkKeys(record, 'family release record', ROOT, failures);
    checkLiteral(record, '', 'schema', FAMILY_SCHEMA_VERSION, failures);
    checkLiteral(record, '', 'protocol', FAMILY_PROTOCOL, failures);
    checkPattern(record, '', 'candidateReceiptSha256', patterns.sha256, descriptions.sha256, failures);
    checkPattern(record, '', 'releaseNotesSha256', patterns.sha256, descriptions.sha256, failures);
    const family = checkFamily(record, failures);
    checkPackages(record, family, failures);
    checkSource(record, family.version, failures);
    return failures;
}

function checkFamily(
    record: Fields,
    failures: string[],
): { version: string | null; distTag: string | null } {
    const fields = nested(record, '', 'family', ['name', 'version', 'distTag'], failures);
    if (fields === null) return { version: null, distTag: null };
    checkPattern(fields, 'family', 'name', patterns.packageName, 'a valid npm package name', failures);
    const version = checkPattern(
        fields, 'family', 'version', patterns.semver, descriptions.semver, failures,
    );
    const distTag = checkPattern(
        fields, 'family', 'distTag', patterns.distTag, 'a valid npm dist-tag', failures,
    );
    return { version, distTag };
}

function checkPackages(
    record: Fields,
    family: { version: string | null; distTag: string | null },
    failures: string[],
): void {
    const packages = record.packages;
    if (!Array.isArray(packages) || packages.length < 2) {
        failures.push('packages must contain at least two members.');
        return;
    }
    const names: Set<string> = new Set();
    for (const [index, value] of packages.entries()) {
        const label = 'packages[' + String(index) + ']';
        const member = asRecord(value);
        if (member === null) {
            failures.push(label + ' must be a JSON object.');
            continue;
        }
        checkKeys(member, label, ['name', 'version', 'distTag', 'candidate', 'registry'], failures);
        const name = checkPattern(member, label, 'name', patterns.packageName, 'a valid npm package name', failures);
        const version = checkPattern(member, label, 'version', patterns.semver, descriptions.semver, failures);
        const distTag = checkPattern(member, label, 'distTag', patterns.distTag, 'a valid npm dist-tag', failures);
        if (name !== null && names.has(name)) failures.push(label + '.name must be unique.');
        if (name !== null) names.add(name);
        if (version !== null && family.version !== null && version !== family.version) {
            failures.push(label + '.version must equal family.version.');
        }
        if (distTag !== null && family.distTag !== null && distTag !== family.distTag) {
            failures.push(label + '.distTag must equal family.distTag.');
        }
        const candidate = checkCandidate(member, label, failures);
        checkRegistry(member, label, candidate, failures);
    }
}

function checkCandidate(
    member: Fields,
    label: string,
    failures: string[],
): { sha256: string | null; sha512: string | null } {
    const fields = nested(member, label, 'candidate', ['sha256', 'sha512'], failures);
    if (fields === null) return { sha256: null, sha512: null };
    return {
        sha256: checkPattern(fields, label + '.candidate', 'sha256', patterns.sha256, descriptions.sha256, failures),
        sha512: checkPattern(fields, label + '.candidate', 'sha512', patterns.sha512, descriptions.sha512, failures),
    };
}

function checkRegistry(
    member: Fields,
    label: string,
    candidate: { sha256: string | null; sha512: string | null },
    failures: string[],
): void {
    const keys = ['sha256', 'sha512', 'integrityVerified', 'signatureVerified', 'provenanceVerified'];
    const fields = nested(member, label, 'registry', keys, failures);
    if (fields === null) return;
    const sha256 = checkPattern(fields, label + '.registry', 'sha256', patterns.sha256, descriptions.sha256, failures);
    const sha512 = checkPattern(fields, label + '.registry', 'sha512', patterns.sha512, descriptions.sha512, failures);
    checkLiteral(fields, label + '.registry', 'integrityVerified', true, failures);
    checkLiteral(fields, label + '.registry', 'signatureVerified', true, failures);
    checkLiteral(fields, label + '.registry', 'provenanceVerified', true, failures);
    checkPublicBytesMatch('sha256', candidate.sha256, sha256, failures);
    checkPublicBytesMatch('sha512', candidate.sha512, sha512, failures);
}

function checkSource(
    record: Fields,
    version: string | null,
    failures: string[],
): void {
    const fields = nested(record, '', 'source', ['repository', 'tag', 'commit'], failures);
    if (fields === null) return;
    checkPattern(fields, 'source', 'repository', patterns.repository, descriptions.repository, failures);
    const tag = checkPattern(fields, 'source', 'tag', patterns.releaseTag, descriptions.tag, failures);
    checkPattern(fields, 'source', 'commit', patterns.commit, descriptions.commit, failures);
    checkTagMatchesVersion(tag, version, failures);
}
