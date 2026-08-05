import { createHash } from 'node:crypto';

import type {
    TarballDigest,
    TarballUnchangedResult,
    VerifyTarballUnchangedInput,
} from './model.ts';

export function hashTarball(buffer: Buffer): TarballDigest {
    const sha512 = createHash('sha512').update(buffer).digest();
    return {
        bytes: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        sha512: sha512.toString('hex'),
        integrity: `sha512-${sha512.toString('base64')}`,
    };
}

// The authoritative tarball is copied before package code runs; the copy must come back identical.
export function verifyTarballUnchanged(
    input: VerifyTarballUnchangedInput,
): TarballUnchangedResult {
    const after = hashTarball(input.afterBuffer);
    const failures: string[] = [];
    if (after.bytes !== input.before.bytes) {
        failures.push(
            'Candidate tarball byte length changed: '
            + `recorded ${String(input.before.bytes)}, recomputed ${String(after.bytes)}.`,
        );
    }
    if (after.sha256 !== input.before.sha256) {
        failures.push(
            `Candidate tarball sha256 changed: recorded ${input.before.sha256}, recomputed ${after.sha256}.`,
        );
    }
    if (after.sha512 !== input.before.sha512) {
        failures.push(
            `Candidate tarball sha512 changed: recorded ${input.before.sha512}, recomputed ${after.sha512}.`,
        );
    }
    if (after.integrity !== input.before.integrity) {
        failures.push(
            `Candidate tarball integrity changed: recorded ${input.before.integrity}, recomputed ${after.integrity}.`,
        );
    }
    return { unchanged: failures.length === 0, after, failures };
}
