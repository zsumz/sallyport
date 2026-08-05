import { createHash } from 'node:crypto';
import type { CandidateReceipt } from '../candidate/receipt.ts';
import type { RegistryVersionMeta } from './download.ts';

// Hashing is duplicated from the candidate area on purpose: the verifier that
// compares public bytes must not share code with the producer of the digests
// it is checking, and src/registry stays decoupled from src/candidate.
export interface TarballDigest {
    bytes: number;
    sha256: string;
    sha512: string;
    integrity: string;
}

export interface PackedManifest {
    name: string;
    version: string;
}

export interface RegistryIntegrityInput {
    receipt: CandidateReceipt;
    versionMeta: RegistryVersionMeta;
    publicTarball: Uint8Array;
    packedManifest: PackedManifest | null;
}

export type RegistryIntegrityResult =
    | { ok: true; digest: TarballDigest }
    | { ok: false; digest: TarballDigest; failures: string[] };

export function sha256Hex(data: Uint8Array): string {
    return createHash('sha256').update(data).digest('hex');
}

export function sha512Hex(data: Uint8Array): string {
    return createHash('sha512').update(data).digest('hex');
}

export function subresourceIntegrity(data: Uint8Array): string {
    return `sha512-${createHash('sha512').update(data).digest('base64')}`;
}

export function digestTarball(data: Uint8Array): TarballDigest {
    return {
        bytes: data.byteLength,
        sha256: sha256Hex(data),
        sha512: sha512Hex(data),
        integrity: subresourceIntegrity(data),
    };
}

// Design §11 Step D. Every check runs; the caller sees the complete failure set.
export function compareRegistryIntegrity(
    input: RegistryIntegrityInput,
): RegistryIntegrityResult {
    const { receipt, versionMeta, packedManifest } = input;
    const digest = digestTarball(input.publicTarball);
    const failures: string[] = [];
    const label = `${receipt.package.name}@${receipt.package.version}`;

    if (versionMeta.integrity !== receipt.tarball.integrity) {
        failures.push(
            `Registry dist.integrity ${versionMeta.integrity} does not match candidate ${receipt.tarball.integrity}.`,
        );
    }
    if (digest.integrity !== receipt.tarball.integrity) {
        failures.push(
            `Public tarball integrity ${digest.integrity} does not match candidate ${receipt.tarball.integrity}.`,
        );
    }
    if (digest.sha256 !== receipt.tarball.sha256) {
        failures.push(
            `Public tarball sha256 ${digest.sha256} does not match candidate ${receipt.tarball.sha256}.`,
        );
    }
    if (digest.sha512 !== receipt.tarball.sha512) {
        failures.push(
            `Public tarball sha512 ${digest.sha512} does not match candidate ${receipt.tarball.sha512}.`,
        );
    }
    if (digest.bytes !== receipt.tarball.bytes) {
        failures.push(
            `Public tarball is ${String(digest.bytes)} bytes, candidate recorded ${String(receipt.tarball.bytes)}.`,
        );
    }
    if (versionMeta.version !== receipt.package.version) {
        failures.push(
            `Registry metadata is for version ${versionMeta.version}, expected ${receipt.package.version}.`,
        );
    }
    if (packedManifest === null) {
        failures.push(`Packed manifest for ${label} was not supplied for comparison.`);
    } else {
        if (packedManifest.name !== receipt.package.name) {
            failures.push(
                `Packed manifest name ${packedManifest.name} does not match candidate ${receipt.package.name}.`,
            );
        }
        if (packedManifest.version !== receipt.package.version) {
            failures.push(
                `Packed manifest version ${packedManifest.version} does not match candidate ${receipt.package.version}.`,
            );
        }
    }

    if (failures.length > 0) {
        return { ok: false, digest, failures };
    }
    return { ok: true, digest };
}
