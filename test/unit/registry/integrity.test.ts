import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CandidateReceipt } from '../../../src/candidate/receipt.ts';
import type { RegistryVersionMeta } from '../../../src/registry/download.ts';
import {
    compareRegistryIntegrity,
    digestTarball,
    sha256Hex,
    sha512Hex,
    subresourceIntegrity,
    type RegistryIntegrityInput,
} from '../../../src/registry/integrity.ts';

const TARBALL = new Uint8Array(Buffer.from('sallyport candidate tarball bytes'));
const OTHER = new Uint8Array(Buffer.from('a different tarball entirely'));
const SHA256 = createHash('sha256').update(TARBALL).digest('hex');
const SHA512 = createHash('sha512').update(TARBALL).digest('hex');
const INTEGRITY = `sha512-${createHash('sha512').update(TARBALL).digest('base64')}`;

function makeReceipt(): CandidateReceipt {
    return {
        schema: 1,
        protocol: 'sallyport/0.1',
        sallyport: {
            version: '0.1.0',
            workflow: 'zsumz/sallyport/.github/workflows/stage.yml',
            sha: 'a'.repeat(40),
        },
        repository: { name: 'zsumz/demo', id: 42, defaultBranch: 'main' },
        source: {
            tag: 'v1.2.3',
            commit: 'b'.repeat(40),
            signed: true,
            signerFingerprint: null,
        },
        package: {
            name: 'demo',
            version: '1.2.3',
            access: 'public',
            distTag: 'latest',
        },
        tarball: {
            filename: 'package.tgz',
            bytes: TARBALL.byteLength,
            sha256: SHA256,
            sha512: SHA512,
            integrity: INTEGRITY,
        },
        run: { id: 123456789, attempt: 1 },
    };
}

function makeVersionMeta(): RegistryVersionMeta {
    return {
        version: '1.2.3',
        tarball: 'https://registry.npmjs.org/demo/-/demo-1.2.3.tgz',
        integrity: INTEGRITY,
        shasum: 'd'.repeat(40),
    };
}

function makeInput(): RegistryIntegrityInput {
    return {
        receipt: makeReceipt(),
        versionMeta: makeVersionMeta(),
        publicTarball: TARBALL,
        packedManifest: { name: 'demo', version: '1.2.3' },
    };
}

function failuresOf(input: RegistryIntegrityInput): string[] {
    const result = compareRegistryIntegrity(input);
    return result.ok ? [] : result.failures;
}

describe('digest helpers', () => {
    it('hashes fixed bytes', () => {
        expect(sha256Hex(TARBALL)).toBe(SHA256);
        expect(sha512Hex(TARBALL)).toBe(SHA512);
        expect(subresourceIntegrity(TARBALL)).toBe(INTEGRITY);
        expect(digestTarball(TARBALL)).toStrictEqual({
            bytes: TARBALL.byteLength,
            sha256: SHA256,
            sha512: SHA512,
            integrity: INTEGRITY,
        });
    });

    it('matches the published sha256 of a known buffer', () => {
        expect(sha256Hex(new Uint8Array(Buffer.from('abc')))).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
    });
});

describe('compareRegistryIntegrity', () => {
    it('accepts byte-identical public bytes', () => {
        const result = compareRegistryIntegrity(makeInput());
        expect(result.ok).toBe(true);
        expect(result.digest.sha256).toBe(SHA256);
    });

    it('rejects a registry integrity that differs from the candidate', () => {
        const input = makeInput();
        input.versionMeta.integrity = 'sha512-Zm9v';
        const failures = failuresOf(input);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('Registry dist.integrity');
    });

    it('rejects public bytes that differ from the candidate', () => {
        const input = makeInput();
        input.publicTarball = OTHER;
        const failures = failuresOf(input);
        expect(failures.join('\n')).toContain('Public tarball integrity');
        expect(failures.join('\n')).toContain('Public tarball sha256');
        expect(failures.join('\n')).toContain('Public tarball sha512');
        expect(failures.join('\n')).toContain('bytes, candidate recorded');
        expect(failures).toHaveLength(4);
    });

    it('rejects a byte-length disagreement on its own', () => {
        const input = makeInput();
        input.receipt.tarball.bytes = TARBALL.byteLength + 1;
        expect(failuresOf(input)).toStrictEqual([
            `Public tarball is ${String(TARBALL.byteLength)} bytes, candidate recorded ${String(TARBALL.byteLength + 1)}.`,
        ]);
    });

    it('rejects registry metadata for the wrong version', () => {
        const input = makeInput();
        input.versionMeta.version = '1.2.4';
        const failures = failuresOf(input);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('Registry metadata is for version 1.2.4');
    });

    it('rejects a packed manifest name mismatch', () => {
        const input = makeInput();
        input.packedManifest = { name: 'other', version: '1.2.3' };
        const failures = failuresOf(input);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('Packed manifest name other');
    });

    it('rejects a packed manifest version mismatch', () => {
        const input = makeInput();
        input.packedManifest = { name: 'demo', version: '1.2.4' };
        const failures = failuresOf(input);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('Packed manifest version 1.2.4');
    });

    it('fails closed when no packed manifest was supplied', () => {
        const input = makeInput();
        input.packedManifest = null;
        expect(failuresOf(input)).toStrictEqual([
            'Packed manifest for demo@1.2.3 was not supplied for comparison.',
        ]);
    });

    it('lists every failing check without stopping at the first', () => {
        const input = makeInput();
        input.versionMeta = {
            version: '9.9.9',
            tarball: 'https://registry.npmjs.org/demo/-/demo-9.9.9.tgz',
            integrity: 'sha512-Zm9v',
            shasum: 'd'.repeat(40),
        };
        input.publicTarball = OTHER;
        input.packedManifest = { name: 'other', version: '9.9.9' };
        expect(failuresOf(input)).toHaveLength(8);
    });
});
