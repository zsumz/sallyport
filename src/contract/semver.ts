export interface Semver {
    major: number;
    minor: number;
    patch: number;
    prerelease: string[];
    raw: string;
}

export type DistTagDecision =
    | { distTag: string }
    | { error: string };

export const STABLE_DIST_TAG = 'latest';

const SEMVER_PATTERN =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/u;
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/u;
const DIST_TAG_PATTERN = /^[a-z][a-z0-9-]*$/u;
const VERSION_LIKE_PATTERN = /^v\d/u;
const RESERVED_DIST_TAGS = [STABLE_DIST_TAG, 'x'];

interface SemverMatch {
    major: number;
    minor: number;
    patch: number;
    prerelease: string[];
    build: string | null;
    raw: string;
}

// Build metadata cannot survive tag/version equality or npm dist-tag derivation,
// so quoin treats it as unreleasable rather than silently dropping it.
export function parseSemver(version: string): Semver | null {
    const match = matchSemver(version);
    if (match === null) {
        return null;
    }
    if (match.build !== null) {
        return null;
    }
    return {
        major: match.major,
        minor: match.minor,
        patch: match.patch,
        prerelease: match.prerelease,
        raw: match.raw,
    };
}

export function isStableVersion(version: string): boolean {
    const parsed = parseSemver(version);
    return parsed !== null && parsed.prerelease.length === 0;
}

export function releaseTagForVersion(version: string): string {
    return `v${version}`;
}

export function deriveDistTag(version: string): DistTagDecision {
    const match = matchSemver(version);
    if (match === null) {
        return { error: `${version} is not a valid semantic version.` };
    }
    if (match.build !== null) {
        return { error: `${version} must not carry build metadata.` };
    }
    const [identifier] = match.prerelease;
    if (identifier === undefined) {
        return { distTag: STABLE_DIST_TAG };
    }
    if (NUMERIC_IDENTIFIER_PATTERN.test(identifier)) {
        return {
            error: `${version} is ambiguous; the first prerelease identifier must not be numeric.`,
        };
    }
    if (!DIST_TAG_PATTERN.test(identifier)) {
        return {
            error: `prerelease identifier ${identifier} is not a valid npm dist-tag; use lowercase letters, digits, and hyphens.`,
        };
    }
    if (VERSION_LIKE_PATTERN.test(identifier)) {
        return {
            error: `prerelease identifier ${identifier} looks like a semantic version range.`,
        };
    }
    if (RESERVED_DIST_TAGS.includes(identifier)) {
        return {
            error: `prerelease identifier ${identifier} is a reserved npm dist-tag.`,
        };
    }
    return { distTag: identifier };
}

function matchSemver(version: string): SemverMatch | null {
    const match = SEMVER_PATTERN.exec(version);
    if (match === null) {
        return null;
    }
    const [, major, minor, patch, prerelease, build] = match;
    if (major === undefined || minor === undefined || patch === undefined) {
        return null;
    }
    return {
        major: Number.parseInt(major, 10),
        minor: Number.parseInt(minor, 10),
        patch: Number.parseInt(patch, 10),
        prerelease: prerelease === undefined ? [] : prerelease.split('.'),
        build: build ?? null,
        raw: version,
    };
}
