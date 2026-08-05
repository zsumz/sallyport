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
import { PROTOCOL, RECEIPT_SCHEMA_VERSION } from './model.ts';

const ROOT_KEYS = ['schema', 'protocol', 'candidateReceiptSha256', 'package', 'candidate', 'registry', 'source'];
const PACKAGE_KEYS = ['name', 'version', 'distTag'];
const CANDIDATE_KEYS = ['sha256', 'sha512'];
const REGISTRY_KEYS = ['sha256', 'sha512', 'integrityVerified', 'signatureVerified', 'provenanceVerified'];
const SOURCE_KEYS = ['repository', 'tag', 'commit'];

export function validateReleaseRecord(value: unknown): string[] {
    const record = asRecord(value);
    if (record === null) {
        return ['release record must be a JSON object.'];
    }
    const failures: string[] = [];
    checkKeys(record, 'release record', ROOT_KEYS, failures);
    checkLiteral(record, '', 'schema', RECEIPT_SCHEMA_VERSION, failures);
    checkLiteral(record, '', 'protocol', PROTOCOL, failures);
    checkPattern(record, '', 'candidateReceiptSha256', patterns.sha256, descriptions.sha256, failures);
    const version = checkPackage(record, failures);
    const candidate = checkCandidate(record, failures);
    checkRegistry(record, candidate, failures);
    checkSource(record, version, failures);
    return failures;
}

function checkPackage(record: Fields, failures: string[]): string | null {
    const fields = nested(record, '', 'package', PACKAGE_KEYS, failures);
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
    checkPattern(fields, 'package', 'distTag', patterns.distTag, 'a nonnumeric npm dist-tag', failures);
    return version;
}

function checkCandidate(
    record: Fields,
    failures: string[],
): { sha256: string | null; sha512: string | null } {
    const fields = nested(record, '', 'candidate', CANDIDATE_KEYS, failures);
    if (fields === null) return { sha256: null, sha512: null };
    return {
        sha256: checkPattern(
            fields,
            'candidate',
            'sha256',
            patterns.sha256,
            descriptions.sha256,
            failures,
        ),
        sha512: checkPattern(
            fields,
            'candidate',
            'sha512',
            patterns.sha512,
            descriptions.sha512,
            failures,
        ),
    };
}

function checkRegistry(
    record: Fields,
    candidate: { sha256: string | null; sha512: string | null },
    failures: string[],
): void {
    const fields = nested(record, '', 'registry', REGISTRY_KEYS, failures);
    if (fields === null) return;
    const sha256 = checkPattern(
        fields,
        'registry',
        'sha256',
        patterns.sha256,
        descriptions.sha256,
        failures,
    );
    const sha512 = checkPattern(
        fields,
        'registry',
        'sha512',
        patterns.sha512,
        descriptions.sha512,
        failures,
    );
    checkLiteral(fields, 'registry', 'integrityVerified', true, failures);
    checkLiteral(fields, 'registry', 'signatureVerified', true, failures);
    checkLiteral(fields, 'registry', 'provenanceVerified', true, failures);
    checkPublicBytesMatch('sha256', candidate.sha256, sha256, failures);
    checkPublicBytesMatch('sha512', candidate.sha512, sha512, failures);
}

function checkSource(record: Fields, version: string | null, failures: string[]): void {
    const fields = nested(record, '', 'source', SOURCE_KEYS, failures);
    if (fields === null) return;
    checkPattern(
        fields,
        'source',
        'repository',
        patterns.repository,
        descriptions.repository,
        failures,
    );
    const tag = checkPattern(fields, 'source', 'tag', patterns.releaseTag, descriptions.tag, failures);
    checkPattern(fields, 'source', 'commit', patterns.commit, descriptions.commit, failures);
    checkTagMatchesVersion(tag, version, failures);
}
