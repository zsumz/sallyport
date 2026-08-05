export type Fields = Record<string, unknown>;

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

export function asRecord(value: unknown): Fields | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Fields
        : null;
}

export function checkKeys(
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

export function nested(
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

export function checkPattern(
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

export function checkLiteral(
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

export function checkBoolean(
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

export function checkPositiveInteger(
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

export function checkFingerprint(
    source: Fields,
    signed: boolean | null,
    failures: string[],
): void {
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
    if (typeof value !== 'string' || !patterns.fingerprint.test(value)) {
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

export function checkTagMatchesVersion(
    tag: string | null,
    version: string | null,
    failures: string[],
): void {
    if (tag !== null && version !== null && tag !== `v${version}`) {
        failures.push(`source.tag must be "v${version}" to match package.version.`);
    }
}

export function checkIntegrityMatchesDigest(
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
export function checkPublicBytesMatch(
    algorithm: string,
    candidate: string | null,
    registry: string | null,
    failures: string[],
): void {
    if (candidate !== null && registry !== null && candidate !== registry) {
        failures.push(`registry.${algorithm} must equal candidate.${algorithm}.`);
    }
}

function fieldPath(parent: string, key: string): string {
    return parent === '' ? key : `${parent}.${key}`;
}
