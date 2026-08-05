import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateReleaseRecord } from '../../../src/candidate/receipt.ts';
import type { CommandRunner } from '../../../src/contract/signing.ts';
import { verifyPublicCommand } from '../../../src/cli/internal/verify-public.ts';
import type { BinaryResponse, JsonResponse } from '../../../src/registry/download.ts';
import {
    buildCandidate,
    createEffects,
    makeTempRoot,
    readJsonFile,
    removeTempRoot,
    type CandidateFixture,
    type TestEffects,
} from './fixture.ts';

interface RecordedCommand {
    command: string;
    args: string[];
    cwd: string;
    env: Readonly<Record<string, string | undefined>>;
}

const REGISTRY = 'https://registry.npmjs.org';

let root = '';
let candidate: CandidateFixture;
let outputDir = '';
let harness: TestEffects;
let commands: RecordedCommand[] = [];
let distTags: Record<string, string> = {};
let registryIntegrity = '';
let attestationsBody: unknown = null;
let auditReport: unknown = null;
let tarballUrl = '';

beforeEach(() => {
    root = makeTempRoot('verify');
    candidate = buildCandidate(root);
    outputDir = path.join(root, 'quoin-public');
    commands = [];
    distTags = { latest: candidate.consumer.version };
    registryIntegrity = candidate.digest.integrity;
    tarballUrl = `${REGISTRY}/${candidate.consumer.name}/-/${candidate.consumer.name}-${candidate.consumer.version}.tgz`;
    attestationsBody = attestations();
    auditReport = {
        verified: [{
            name: candidate.consumer.name,
            version: candidate.consumer.version,
            attestations: { provenance: { predicateType: 'https://slsa.dev/provenance/v1' } },
        }],
        invalid: [],
        missing: [],
    };
    harness = createEffects(root, {
        exec: recordingExec,
        registry: { fetchJson, fetchBuffer },
    });
});

afterEach(() => {
    removeTempRoot(root);
});

const recordingExec: CommandRunner = (command, args, options) => {
    commands.push({
        command,
        args: [...args],
        cwd: options.cwd,
        env: options.env ?? {},
    });
    if (command === 'npm' && args[0] === 'audit') {
        return { stdout: JSON.stringify(auditReport), stderr: '' };
    }
    if (command === 'npm' && args[0] === 'install') {
        return { stdout: 'added 1 package', stderr: '' };
    }
    if (command === 'npm' && args[0] === 'run') {
        return { stdout: 'smoke ok\n', stderr: '' };
    }
    throw new Error(`unexpected command ${command} ${args.join(' ')}`);
};

async function fetchJson(url: string): Promise<JsonResponse> {
    if (url === `${REGISTRY}/${candidate.consumer.name}`) {
        return Promise.resolve({ status: 200, body: packument() });
    }
    if (url === `${REGISTRY}/-/package/${candidate.consumer.name}/dist-tags`) {
        return Promise.resolve({ status: 200, body: distTags });
    }
    if (url.includes('/-/npm/v1/attestations/')) {
        return Promise.resolve({ status: 200, body: attestationsBody });
    }
    return Promise.resolve({ status: 404, body: null });
}

async function fetchBuffer(url: string): Promise<BinaryResponse> {
    if (url === tarballUrl) {
        return Promise.resolve({ status: 200, body: new Uint8Array(candidate.tarball) });
    }
    return Promise.resolve({ status: 404, body: new Uint8Array() });
}

function packument(): Record<string, unknown> {
    return {
        name: candidate.consumer.name,
        versions: {
            [candidate.consumer.version]: {
                version: candidate.consumer.version,
                dist: {
                    tarball: tarballUrl,
                    integrity: registryIntegrity,
                    shasum: 'a'.repeat(40),
                },
            },
        },
    };
}

function statement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        _type: 'https://in-toto.io/Statement/v1',
        predicateType: 'https://slsa.dev/provenance/v1',
        subject: [{
            name: `pkg:npm/${candidate.consumer.name}@${candidate.consumer.version}`,
            digest: { sha512: candidate.digest.sha512 },
        }],
        predicate: {
            buildDefinition: {
                externalParameters: {
                    workflow: {
                        repository: 'https://github.com/zsumz/fake',
                        path: '.github/workflows/quoin.yml',
                        ref: `refs/tags/v${candidate.consumer.version}`,
                    },
                },
            },
            runDetails: {
                metadata: {
                    invocationId: `https://github.com/zsumz/fake/actions/runs/${String(candidate.receipt.run.id)}/attempts/1`,
                },
            },
        },
        ...overrides,
    };
}

function attestations(payload: Record<string, unknown> = statement()): Record<string, unknown> {
    return {
        attestations: [{
            predicateType: 'https://slsa.dev/provenance/v1',
            bundle: {
                verificationMaterial: { certificate: { rawBytes: 'Y2VydA==' } },
                dsseEnvelope: {
                    payload: Buffer.from(JSON.stringify(payload)).toString('base64'),
                },
            },
        }],
    };
}

async function verify(overrides: Partial<Record<string, string>> = {}): Promise<void> {
    const values: Record<string, string> = {
        '--consumer': candidate.consumer.dir,
        '--candidate-dir': candidate.dir,
        '--output': outputDir,
        '--profile': 'standard',
        ...overrides,
    };
    await verifyPublicCommand(
        Object.entries(values).flatMap(([flag, value]) => [flag, value]),
        harness.effects,
    );
}

describe('internal verify-public', () => {
    it('writes a release record for byte-identical public bytes', async () => {
        await verify();

        const record = readJsonFile(path.join(outputDir, 'release.json'));
        expect(validateReleaseRecord(record)).toEqual([]);
        expect(record).toMatchObject({
            candidateReceiptSha256: expect.any(String) as unknown,
            package: {
                name: candidate.consumer.name,
                version: candidate.consumer.version,
                distTag: 'latest',
            },
            candidate: { sha256: candidate.digest.sha256, sha512: candidate.digest.sha512 },
            registry: {
                sha256: candidate.digest.sha256,
                sha512: candidate.digest.sha512,
                integrityVerified: true,
                signatureVerified: true,
                provenanceVerified: true,
            },
            source: {
                repository: 'zsumz/fake',
                tag: `v${candidate.consumer.version}`,
                commit: candidate.consumer.commit,
            },
        });
    });

    it('reports the release path and the public digest', async () => {
        await verify();

        expect(harness.outputs).toEqual([{
            release: path.join(outputDir, 'release.json'),
            public_sha256: candidate.digest.sha256,
        }]);
        expect(harness.summaries.join('')).toContain('### quoin public verification');
    });

    it('keeps a copy of the downloaded public tarball', async () => {
        await verify();

        expect(readFileSync(path.join(outputDir, 'public-package.tgz')))
            .toEqual(candidate.tarball);
    });

    it('installs the public package in an isolated directory before auditing', async () => {
        await verify();

        const install = commands.find((entry) => entry.args[0] === 'install');
        expect(install?.args).toEqual([
            'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--cache',
            path.join(outputDir, 'provenance', '.npm-cache'),
        ]);
        expect(install?.cwd).toBe(path.join(outputDir, 'provenance'));
        expect(readJsonFile(path.join(outputDir, 'provenance', 'package.json'))).toEqual({
            dependencies: { [candidate.consumer.name]: candidate.consumer.version },
        });
    });

    it('smokes the public tarball copy through release:smoke', async () => {
        await verify();

        const smoke = commands.find((entry) => entry.args[0] === 'run');
        expect(smoke?.args).toEqual(['run', 'release:smoke']);
        expect(smoke?.cwd).toBe(candidate.consumer.dir);
        expect(smoke?.env.QUOIN_TARBALL)
            .toContain(path.join('quoin-public-smoke', 'smoke-package.tgz'));
        expect(smoke?.env.QUOIN_PACKAGE).toBe(candidate.consumer.name);
        expect(smoke?.env.QUOIN_VERSION).toBe(candidate.consumer.version);
        expect(smoke?.env.QUOIN_DIST_TAG).toBe('latest');
    });

    it('fails when the registry integrity disagrees with the candidate', async () => {
        registryIntegrity = `sha512-${'B'.repeat(86)}==`;

        await expect(verify()).rejects.toThrow(/does not match candidate/u);
        expect(existsSync(path.join(outputDir, 'release.json'))).toBe(false);
    });

    it('fails when the dist-tag never converges', async () => {
        distTags = {};

        await expect(verify())
            .rejects.toThrow(/did not converge after 30 attempts/u);
    });

    it('fails when npm reports no verified signature', async () => {
        auditReport = { verified: [], invalid: [], missing: [] };

        await expect(verify()).rejects.toThrow(/did not verify the registry signature/u);
    });

    it('fails when the provenance names a different repository', async () => {
        attestationsBody = attestations(statement({
            predicate: {
                buildDefinition: {
                    externalParameters: {
                        workflow: {
                            repository: 'https://github.com/attacker/fake',
                            path: '.github/workflows/quoin.yml',
                            ref: `refs/tags/v${candidate.consumer.version}`,
                        },
                    },
                },
            },
        }));

        await expect(verify()).rejects.toThrow(/Provenance repository attacker\/fake/u);
    });

    it('fails when no provenance attestation is published', async () => {
        attestationsBody = { attestations: [] };

        await expect(verify()).rejects.toThrow(/No attestations are published/u);
    });

    it('fails when the candidate directory bytes disagree with the receipt', async () => {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(path.join(candidate.dir, 'package.tgz'), 'tampered');

        await expect(verify())
            .rejects.toThrow(/the candidate tarball sha256 .* does not match candidate.json/u);
    });

    it('requires a fingerprint under the strict profile', async () => {
        await expect(verify({ '--profile': 'strict' }))
            .rejects.toThrow(/requires a 40-hexadecimal signer fingerprint/u);
    });

    it('refuses an unsigned candidate under the strict profile', async () => {
        await expect(verify({ '--profile': 'strict', '--signer-fingerprint': 'B'.repeat(40) }))
            .rejects.toThrow(/records an unsigned tag/u);
    });

    it('defaults to the standard profile when none is supplied', async () => {
        await verifyPublicCommand([
            '--consumer', candidate.consumer.dir,
            '--candidate-dir', candidate.dir,
            '--output', outputDir,
        ], harness.effects);

        expect(harness.outputs).toHaveLength(1);
    });
});
