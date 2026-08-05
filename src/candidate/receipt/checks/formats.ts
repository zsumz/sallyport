const SEMVER_BODY = '(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)'
    + '(?:-(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)'
    + '(?:\\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*)?'
    + '(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?';

export const patterns = {
    semver: new RegExp(`^${SEMVER_BODY}$`),
    releaseTag: new RegExp(`^v${SEMVER_BODY}$`),
    commit: /^[0-9a-f]{40}$/,
    sha256: /^[0-9a-f]{64}$/,
    sha512: /^[0-9a-f]{128}$/,
    integrity: /^sha512-[A-Za-z0-9+/]{86}==$/,
    fingerprint: /^[0-9A-F]{40}$/,
    repository: /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/,
    workflow: /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+\/\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/,
    packageName: /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,
    distTag: /^[A-Za-z][A-Za-z0-9._-]*$/,
    branch: /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
} as const;

export const descriptions = {
    commit: 'a 40-character lowercase hexadecimal commit SHA',
    sha256: 'a 64-character lowercase hexadecimal SHA-256 digest',
    sha512: 'a 128-character lowercase hexadecimal SHA-512 digest',
    semver: 'a valid SemVer version',
    tag: 'a v<version> release tag',
    repository: 'an owner/name GitHub repository',
} as const;
