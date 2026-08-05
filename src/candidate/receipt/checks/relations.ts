import type { Fields } from './fields.ts';
import { patterns } from './formats.ts';

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
