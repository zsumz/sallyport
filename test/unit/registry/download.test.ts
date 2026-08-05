import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CandidateReceipt } from '../../../src/candidate/receipt.ts';
import {
    attestationsUrl,
    awaitRegistryConvergence,
    classifyRegistryState,
    distTagsUrl,
    downloadTarball,
    extractVersionMeta,
    fetchDistTags,
    fetchPackument,
    packumentUrl,
    retryPlan,
    shouldContinue,
    type FetchBuffer,
    type FetchJson,
    type RegistryState,
} from '../../../src/registry/download.ts';

const TARBALL = Buffer.from('sallyport candidate tarball bytes');
const INTEGRITY = `sha512-${createHash('sha512').update(TARBALL).digest('base64')}`;
const TARBALL_URL = 'https://registry.npmjs.org/demo/-/demo-1.2.3.tgz';

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
            signerFingerprint: 'C'.repeat(40),
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
            sha256: createHash('sha256').update(TARBALL).digest('hex'),
            sha512: createHash('sha512').update(TARBALL).digest('hex'),
            integrity: INTEGRITY,
        },
        run: { id: 123456789, attempt: 1 },
    };
}

function makePackument(dist: Record<string, string>, version = '1.2.3'): unknown {
    return {
        name: 'demo',
        versions: {
            [version]: { name: 'demo', version, dist },
        },
    };
}

function goodDist(): Record<string, string> {
    return {
        tarball: TARBALL_URL,
        integrity: INTEGRITY,
        shasum: 'd'.repeat(40),
    };
}

describe('registry urls', () => {
    it('builds packument, dist-tag and attestation urls', () => {
        expect(packumentUrl('https://registry.npmjs.org/', 'demo'))
            .toBe('https://registry.npmjs.org/demo');
        expect(distTagsUrl('https://registry.npmjs.org', 'demo'))
            .toBe('https://registry.npmjs.org/-/package/demo/dist-tags');
        expect(attestationsUrl('https://registry.npmjs.org', 'demo', '1.2.3'))
            .toBe('https://registry.npmjs.org/-/npm/v1/attestations/demo@1.2.3');
    });

    it('escapes the scope separator', () => {
        expect(packumentUrl('https://registry.npmjs.org', '@zsumz/demo'))
            .toBe('https://registry.npmjs.org/@zsumz%2Fdemo');
        expect(attestationsUrl('https://registry.npmjs.org', '@zsumz/demo', '1.0.0'))
            .toBe('https://registry.npmjs.org/-/npm/v1/attestations/@zsumz%2Fdemo@1.0.0');
    });
});

describe('extractVersionMeta', () => {
    it('reads dist metadata for the exact version', () => {
        const lookup = extractVersionMeta(makePackument(goodDist()), 'demo', '1.2.3');
        expect(lookup).toStrictEqual({
            outcome: 'found',
            meta: {
                version: '1.2.3',
                tarball: TARBALL_URL,
                integrity: INTEGRITY,
                shasum: 'd'.repeat(40),
            },
        });
    });

    it('reports an absent version rather than a malformed document', () => {
        expect(extractVersionMeta(null, 'demo', '1.2.3').outcome).toBe('absent');
        expect(extractVersionMeta({}, 'demo', '1.2.3').outcome).toBe('absent');
        expect(extractVersionMeta({ versions: {} }, 'demo', '1.2.3').outcome).toBe('absent');
    });

    it('reports malformed dist metadata for a published version', () => {
        const lookup = extractVersionMeta(
            makePackument({ tarball: TARBALL_URL }),
            'demo',
            '1.2.3',
        );
        expect(lookup.outcome).toBe('malformed');
        expect(lookup.outcome === 'malformed' ? lookup.failures : []).toHaveLength(2);
    });

    it('rejects a document for a different package', () => {
        const lookup = extractVersionMeta({ name: 'other', versions: {} }, 'demo', '1.2.3');
        expect(lookup.outcome).toBe('malformed');
    });
});

describe('classifyRegistryState', () => {
    it('converges when version, integrity and dist-tag agree', () => {
        const state = classifyRegistryState({
            candidate: makeReceipt(),
            packument: makePackument(goodDist()),
            distTags: { latest: '1.2.3' },
        });
        expect(state.state).toBe('converged');
        expect(state.state === 'converged' ? state.versionMeta.tarball : '').toBe(TARBALL_URL);
    });

    it('is pending while the version is not visible', () => {
        const state = classifyRegistryState({
            candidate: makeReceipt(),
            packument: { name: 'demo', versions: {} },
            distTags: {},
        });
        expect(state.state).toBe('pending');
    });

    it('is pending while the dist-tag is not visible', () => {
        const state = classifyRegistryState({
            candidate: makeReceipt(),
            packument: makePackument(goodDist()),
            distTags: {},
        });
        expect(state).toStrictEqual({
            state: 'pending',
            reason: 'dist-tag latest is not visible for demo yet.',
        });
    });

    it('is pending while the dist-tag points at another version', () => {
        const state = classifyRegistryState({
            candidate: makeReceipt(),
            packument: makePackument(goodDist()),
            distTags: { latest: '1.2.2' },
        });
        expect(state).toStrictEqual({
            state: 'pending',
            reason: 'dist-tag latest points at 1.2.2, expected 1.2.3.',
        });
    });

    it('is a mismatch when the registry integrity differs', () => {
        const state = classifyRegistryState({
            candidate: makeReceipt(),
            packument: makePackument({ ...goodDist(), integrity: 'sha512-Zm9v' }),
            distTags: { latest: '1.2.3' },
        });
        expect(state.state).toBe('mismatch');
        expect(state.state === 'mismatch' ? state.failures[0] : '')
            .toContain('does not match candidate');
    });

    it('is a mismatch when the tarball is served by another origin', () => {
        const state = classifyRegistryState({
            candidate: makeReceipt(),
            packument: makePackument({
                ...goodDist(),
                tarball: 'https://evil.example.com/demo/-/demo-1.2.3.tgz',
            }),
            distTags: { latest: '1.2.3' },
        });
        expect(state.state).toBe('mismatch');
        expect(state.state === 'mismatch' ? state.failures[0] : '')
            .toContain('https://evil.example.com');
    });

    it('lists every permanent failure at once', () => {
        const state = classifyRegistryState({
            candidate: makeReceipt(),
            packument: makePackument({
                tarball: 'not-a-url',
                integrity: 'sha512-Zm9v',
                shasum: 'd'.repeat(40),
            }),
            distTags: { latest: '1.2.3' },
        });
        expect(state.state === 'mismatch' ? state.failures : []).toHaveLength(2);
    });

    it('honours an alternate registry base', () => {
        const state = classifyRegistryState({
            candidate: makeReceipt(),
            packument: makePackument({
                ...goodDist(),
                tarball: 'https://npm.example.com/demo/-/demo-1.2.3.tgz',
            }),
            distTags: { latest: '1.2.3' },
            registry: 'https://npm.example.com',
        });
        expect(state.state).toBe('converged');
    });
});

describe('retry policy', () => {
    it('pins the bounded convergence window', () => {
        expect(retryPlan.attempts).toBe(30);
        expect(retryPlan.intervalMs).toBe(10_000);
        expect(retryPlan.maxDurationMs).toBe(300_000);
        expect(retryPlan.attempts * retryPlan.intervalMs).toBe(retryPlan.maxDurationMs);
    });

    it('keeps retrying a pending state inside the window', () => {
        const pending: RegistryState = { state: 'pending', reason: 'not yet' };
        expect(shouldContinue(1, pending)).toBe(true);
        expect(shouldContinue(29, pending)).toBe(true);
        expect(shouldContinue(30, pending)).toBe(false);
    });

    it('never retries a mismatch', () => {
        const mismatch: RegistryState = { state: 'mismatch', failures: ['integrity'] };
        expect(shouldContinue(1, mismatch)).toBe(false);
        expect(shouldContinue(29, mismatch)).toBe(false);
    });

    it('stops once converged', () => {
        const converged: RegistryState = {
            state: 'converged',
            versionMeta: {
                version: '1.2.3',
                tarball: TARBALL_URL,
                integrity: INTEGRITY,
                shasum: 'd'.repeat(40),
            },
        };
        expect(shouldContinue(1, converged)).toBe(false);
    });
});

interface FakeRegistry {
    fetchJson: FetchJson;
    fetchBuffer: FetchBuffer;
    urls: string[];
}

function fakeRegistry(pages: Array<{ packument: unknown; distTags: unknown }>): FakeRegistry {
    const urls: string[] = [];
    let index = 0;
    return {
        urls,
        fetchJson: async (url) => {
            urls.push(url);
            const page = pages[Math.min(index, pages.length - 1)];
            const isTags = url.includes('/dist-tags');
            if (isTags) {
                index += 1;
            }
            return Promise.resolve({
                status: 200,
                body: isTags ? page?.distTags : page?.packument,
            });
        },
        fetchBuffer: async () => Promise.resolve({ status: 200, body: new Uint8Array() }),
    };
}

describe('awaitRegistryConvergence', () => {
    it('returns as soon as the registry converges', async () => {
        const registry = fakeRegistry([
            { packument: { name: 'demo', versions: {} }, distTags: {} },
            { packument: makePackument(goodDist()), distTags: {} },
            { packument: makePackument(goodDist()), distTags: { latest: '1.2.3' } },
        ]);
        const slept: number[] = [];
        const result = await awaitRegistryConvergence({
            fetch: registry,
            candidate: makeReceipt(),
            sleep: async (milliseconds) => {
                slept.push(milliseconds);
                return Promise.resolve();
            },
        });
        expect(result.state.state).toBe('converged');
        expect(result.attempts).toBe(3);
        expect(slept).toStrictEqual([10_000, 10_000]);
    });

    it('stops immediately on a mismatch and never sleeps', async () => {
        const registry = fakeRegistry([
            {
                packument: makePackument({ ...goodDist(), integrity: 'sha512-Zm9v' }),
                distTags: { latest: '1.2.3' },
            },
        ]);
        const slept: number[] = [];
        const result = await awaitRegistryConvergence({
            fetch: registry,
            candidate: makeReceipt(),
            sleep: async (milliseconds) => {
                slept.push(milliseconds);
                return Promise.resolve();
            },
        });
        expect(result.state.state).toBe('mismatch');
        expect(result.attempts).toBe(1);
        expect(slept).toStrictEqual([]);
    });

    it('exhausts the bounded window while pending', async () => {
        const registry = fakeRegistry([
            { packument: { name: 'demo', versions: {} }, distTags: {} },
        ]);
        const slept: number[] = [];
        const result = await awaitRegistryConvergence({
            fetch: registry,
            candidate: makeReceipt(),
            sleep: async (milliseconds) => {
                slept.push(milliseconds);
                return Promise.resolve();
            },
        });
        expect(result.state.state).toBe('pending');
        expect(result.attempts).toBe(retryPlan.attempts);
        expect(slept).toHaveLength(retryPlan.attempts - 1);
    });

    it('treats a failing registry query as pending', async () => {
        const failing = {
            fetchJson: async () => Promise.resolve({ status: 500, body: null }),
            fetchBuffer: async () => Promise.resolve({ status: 500, body: new Uint8Array() }),
        };
        const result = await awaitRegistryConvergence({
            fetch: failing,
            candidate: makeReceipt(),
            sleep: async () => Promise.resolve(),
        });
        expect(result.state.state).toBe('pending');
        expect(result.state.state === 'pending' ? result.state.reason : '')
            .toContain('registry query failed');
    });
});

describe('registry requests', () => {
    it('treats 404 as an absent document', async () => {
        const fetchJson: FetchJson = async () => Promise.resolve({ status: 404, body: null });
        const lookup = { registry: 'https://registry.npmjs.org', packageName: 'demo' };
        await expect(fetchPackument(fetchJson, lookup)).resolves.toBeNull();
        await expect(fetchDistTags(fetchJson, lookup)).resolves.toBeNull();
    });

    it('throws on any other registry status', async () => {
        const fetchJson: FetchJson = async () => Promise.resolve({ status: 503, body: null });
        await expect(fetchPackument(fetchJson, {
            registry: 'https://registry.npmjs.org',
            packageName: 'demo',
        })).rejects.toThrow('returned 503');
    });

    it('downloads tarball bytes', async () => {
        const fetchBuffer: FetchBuffer = async () => Promise.resolve({
            status: 200,
            body: new Uint8Array(TARBALL),
        });
        await expect(downloadTarball(fetchBuffer, TARBALL_URL))
            .resolves.toStrictEqual(new Uint8Array(TARBALL));
    });

    it('throws when the tarball is unavailable', async () => {
        const fetchBuffer: FetchBuffer = async () => Promise.resolve({
            status: 404,
            body: new Uint8Array(),
        });
        await expect(downloadTarball(fetchBuffer, TARBALL_URL)).rejects.toThrow('returned 404');
    });
});
