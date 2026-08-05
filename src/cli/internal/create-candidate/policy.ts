import { readFile } from 'node:fs/promises';

import { hashTarball, type TarballDigest } from '../../../candidate/inspect.ts';
import { normalizeFingerprint } from '../../../contract/signing.ts';
import { normalizeCommitSha } from '../../pins.ts';
import { failure } from '../../support.ts';
import type { Profile } from '../../template.ts';

export function requireCommit(value: string, flag: string): string {
    const normalized = normalizeCommitSha(value);
    if (normalized === null) {
        throw new Error(
            `Candidate receipt failed: --${flag} must be a full 40-character commit SHA.`,
        );
    }
    return normalized;
}

// source.signed comes from the flag alone; the profile is only cross-checked so
// a strict caller can never produce an unsigned receipt.
export function signerFingerprint(
    signed: boolean,
    profile: Profile,
    requested: string | undefined,
): string | null {
    if (signed && profile !== 'strict') {
        throw new Error(
            'Candidate receipt failed: --signed true requires the strict profile.',
        );
    }
    if (!signed && profile === 'strict') {
        throw new Error(
            'Candidate receipt failed: the strict profile requires a signed tag.',
        );
    }
    if (!signed) {
        return null;
    }
    const fingerprint = requested === undefined ? null : normalizeFingerprint(requested);
    if (fingerprint === null) {
        throw new Error(
            'Candidate receipt failed: --signer-fingerprint must be 40 hexadecimal characters'
            + ' when the tag is signed.',
        );
    }
    return fingerprint;
}

export async function assertStagedTarball(staged: string, digest: TarballDigest): Promise<void> {
    let bytes: Buffer;
    try {
        bytes = await readFile(staged);
    } catch {
        throw failure('Candidate receipt failed:', [
            `${staged} must exist; the candidate is packed exactly once into the output directory.`,
        ]);
    }
    const stagedDigest = hashTarball(bytes);
    if (stagedDigest.sha256 !== digest.sha256 || stagedDigest.sha512 !== digest.sha512) {
        throw failure('Candidate receipt failed:', [
            `${staged} sha256 ${stagedDigest.sha256} does not match the packed candidate ${digest.sha256}.`,
        ]);
    }
}
