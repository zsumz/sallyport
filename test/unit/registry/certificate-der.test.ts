import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';

import {
    verifyProvenanceBundle,
    type ExpectedProvenance,
} from '../../../src/registry/provenance.ts';

const EXPECTED: ExpectedProvenance = {
    packageName: 'demo',
    packageVersion: '1.2.3',
    repository: 'zsumz/demo',
    repositoryId: 123456,
    workflowPath: '.github/workflows/sallyport.yml',
    builderWorkflow: 'zsumz/sallyport/.github/workflows/stage.yml',
    builderSha: 'a'.repeat(40),
    tagRef: 'refs/tags/v1.2.3',
    sourceCommit: 'b'.repeat(40),
    tarballSha512: 'e'.repeat(128),
    runId: 42,
    runAttempt: 1,
};

describe('provenance certificate DER boundary', () => {
    it.each([
        [Buffer.alloc(0), 'DER value is truncated.'],
        [Buffer.from([0x05, 0x00, 0x00]), 'DER document carries trailing bytes.'],
        [Buffer.from([0x1f, 0x00]), 'high-tag-number DER values are unsupported.'],
        [Buffer.from([0x04, 0x80]), 'DER length is invalid.'],
        [Buffer.from([0x04, 0x85, 0x01, 0x02, 0x03, 0x04, 0x05]), 'DER length is invalid.'],
        [Buffer.from([0x04, 0x82, 0x01]), 'DER length is invalid.'],
        [Buffer.from([0x04, 0x81, 0x00]), 'DER length is not minimally encoded.'],
        [Buffer.from([0x04, 0x81, 0x7f]), 'DER length is not minimally encoded.'],
        [Buffer.from([0x04, 0x02, 0x00]), 'DER value exceeds its container.'],
    ])('fails closed on malformed certificate DER %#', (bytes, message) => {
        const failures = verifyProvenanceBundle({
            bundle: {
                verificationMaterial: {
                    certificate: { rawBytes: bytes.toString('base64') },
                },
                dsseEnvelope: {
                    payload: Buffer.from('{}', 'utf8').toString('base64'),
                },
            },
            expected: EXPECTED,
        });

        expect(failures[0]).toBe(
            `attestation format not recognized: the provenance signing certificate is malformed: ${message}`,
        );
    });
});
