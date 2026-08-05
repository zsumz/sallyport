import { describe, expect, it } from 'vitest';
import {
    STABLE_DIST_TAG,
    deriveDistTag,
    isStableVersion,
    parseSemver,
    releaseTagForVersion,
} from '../../../src/contract/semver.ts';

function distTagOf(version: string): string | null {
    const decision = deriveDistTag(version);
    return 'distTag' in decision ? decision.distTag : null;
}

function distTagError(version: string): string {
    const decision = deriveDistTag(version);
    return 'error' in decision ? decision.error : '';
}

describe('parseSemver', () => {
    it('parses stable versions', () => {
        expect(parseSemver('1.4.0')).toEqual({
            major: 1,
            minor: 4,
            patch: 0,
            prerelease: [],
            raw: '1.4.0',
        });
    });

    it('parses zero versions', () => {
        expect(parseSemver('0.0.0')).toEqual({
            major: 0,
            minor: 0,
            patch: 0,
            prerelease: [],
            raw: '0.0.0',
        });
    });

    it('splits dotted prerelease identifiers', () => {
        expect(parseSemver('1.4.0-alpha.2')?.prerelease).toEqual(['alpha', '2']);
        expect(parseSemver('2.0.0-rc.1.beta')?.prerelease).toEqual([
            'rc',
            '1',
            'beta',
        ]);
    });

    it('rejects leading zeroes in every numeric position', () => {
        expect(parseSemver('01.0.0')).toBeNull();
        expect(parseSemver('1.01.0')).toBeNull();
        expect(parseSemver('1.0.01')).toBeNull();
        expect(parseSemver('1.0.0-01')).toBeNull();
    });

    it('rejects malformed versions', () => {
        const invalid = [
            '',
            '1',
            '1.0',
            'v1.0.0',
            '1.0.0.0',
            '1.0.0-',
            '1.0.0-alpha..1',
            '1.0.0-alpha_1',
            ' 1.0.0',
            '1.0.0 ',
            '1.0.0+',
            'latest',
        ];
        for (const version of invalid) {
            expect(parseSemver(version)).toBeNull();
        }
    });

    it('rejects build metadata because it cannot round-trip through a release', () => {
        expect(parseSemver('1.0.0+build')).toBeNull();
        expect(parseSemver('1.0.0+build.5')).toBeNull();
        expect(parseSemver('1.0.0-alpha.1+sha.abc')).toBeNull();
    });
});

describe('isStableVersion', () => {
    it('accepts released versions without prerelease identifiers', () => {
        expect(isStableVersion('1.4.0')).toBe(true);
        expect(isStableVersion('0.1.2')).toBe(true);
    });

    it('rejects prereleases, build metadata, and invalid input', () => {
        expect(isStableVersion('1.4.0-alpha.2')).toBe(false);
        expect(isStableVersion('1.4.0+build')).toBe(false);
        expect(isStableVersion('1.4')).toBe(false);
    });
});

describe('releaseTagForVersion', () => {
    it('prefixes the version with v', () => {
        expect(releaseTagForVersion('1.4.0')).toBe('v1.4.0');
        expect(releaseTagForVersion('1.4.0-rc.3')).toBe('v1.4.0-rc.3');
    });
});

describe('deriveDistTag', () => {
    it('maps stable versions to latest', () => {
        expect(deriveDistTag('1.4.0')).toEqual({ distTag: STABLE_DIST_TAG });
        expect(deriveDistTag('0.0.1')).toEqual({ distTag: 'latest' });
    });

    it('uses the first prerelease identifier', () => {
        expect(distTagOf('1.4.0-alpha.2')).toBe('alpha');
        expect(distTagOf('1.4.0-beta.1')).toBe('beta');
        expect(distTagOf('1.4.0-rc.3')).toBe('rc');
        expect(distTagOf('1.4.0-next')).toBe('next');
        expect(distTagOf('1.4.0-canary-2.9')).toBe('canary-2');
    });

    it('rejects numeric first identifiers', () => {
        expect(distTagOf('1.0.0-1')).toBeNull();
        expect(distTagError('1.0.0-1')).toContain('numeric');
        expect(distTagOf('1.0.0-0.alpha')).toBeNull();
    });

    it('rejects identifiers that are not valid npm dist-tags', () => {
        expect(distTagOf('1.0.0-Alpha.1')).toBeNull();
        expect(distTagError('1.0.0-Alpha.1')).toContain('lowercase');
        expect(distTagOf('1.0.0--alpha')).toBeNull();
    });

    it('rejects identifiers that look like versions or ranges', () => {
        expect(distTagOf('1.0.0-v2.1')).toBeNull();
        expect(distTagError('1.0.0-v2.1')).toContain('range');
        expect(distTagOf('1.0.0-x.1')).toBeNull();
    });

    it('refuses to move latest with a prerelease', () => {
        expect(distTagOf('1.0.0-latest.1')).toBeNull();
        expect(distTagError('1.0.0-latest.1')).toContain('reserved');
    });

    it('rejects invalid versions and build metadata', () => {
        expect(distTagError('1.0')).toContain('not a valid semantic version');
        expect(distTagError('1.0.0+build')).toContain('build metadata');
        expect(distTagError('1.0.0-alpha.1+build')).toContain('build metadata');
    });
});
