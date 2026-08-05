import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
    createDraftRelease,
    getReleaseByTag,
    planReleaseAction,
    publishDraftRelease,
    publishReleaseBundle,
    uploadReleaseAsset,
    type ExpectedRelease,
    type GithubReleaseTarget,
    type ReleaseAssetUpload,
    type ReleaseState,
} from '../../../src/github/release.ts';
import { sha256Hex } from '../../../src/registry/integrity.ts';
import type { FetchJson, FetchRequest, JsonResponse } from '../../../src/registry/download.ts';

const TAG = 'v1.2.3';
const TARBALL = new Uint8Array(Buffer.from('a fake gzipped npm tarball'));
const RECEIPT = new Uint8Array(Buffer.from('{"schema":1}'));
const RELEASE = new Uint8Array(Buffer.from('{"schema":1,"registry":{}}'));
const SUMS = new Uint8Array(Buffer.from('sha256sums'));

function uploads(): ReleaseAssetUpload[] {
    return [
        { name: 'package.tgz', contentType: 'application/gzip', data: TARBALL },
        { name: 'candidate.json', contentType: 'application/json', data: RECEIPT },
        { name: 'release.json', contentType: 'application/json', data: RELEASE },
        { name: 'SHA256SUMS', contentType: 'text/plain', data: SUMS },
    ];
}

function expectedRelease(): ExpectedRelease {
    return {
        tag: TAG,
        assets: uploads().map((asset) => ({
            name: asset.name,
            sha256: sha256Hex(asset.data),
        })),
        npmPublic: 'verified',
        provenanceVerified: true,
    };
}

function existingRelease(overrides: Partial<ReleaseState> = {}): ReleaseState {
    return {
        id: 900,
        tagName: TAG,
        draft: false,
        htmlUrl: 'https://github.com/zsumz/demo/releases/tag/v1.2.3',
        uploadUrl: 'https://uploads.github.com/repos/zsumz/demo/releases/900/assets{?name,label}',
        assets: uploads().map((asset) => ({
            name: asset.name,
            size: asset.data.byteLength,
            digest: `sha256:${sha256Hex(asset.data)}`,
        })),
        ...overrides,
    };
}

function target(): GithubReleaseTarget {
    return {
        apiBase: 'https://api.github.com',
        uploadBase: 'https://uploads.github.com',
        repository: 'zsumz/demo',
        token: 'gh-token',
    };
}

function releaseBody(release: ReleaseState): Record<string, unknown> {
    return {
        id: release.id,
        tag_name: release.tagName,
        draft: release.draft,
        html_url: release.htmlUrl,
        upload_url: release.uploadUrl,
        assets: release.assets.map((asset) => ({
            name: asset.name,
            size: asset.size,
            digest: asset.digest,
        })),
    };
}

interface RecordedCall {
    url: string;
    method: string;
}

interface FakeApi {
    fetchJson: FetchJson;
    calls: RecordedCall[];
}

function fakeApi(handler: (call: RecordedCall) => JsonResponse): FakeApi {
    const calls: RecordedCall[] = [];
    const fetchJson: FetchJson = async (url, request?: FetchRequest) => {
        const call = { url, method: request?.method ?? 'GET' };
        calls.push(call);
        return Promise.resolve(handler(call));
    };
    return { fetchJson, calls };
}

describe('planReleaseAction', () => {
    it('creates a draft when no release exists', () => {
        expect(planReleaseAction(null, expectedRelease())).toStrictEqual({ action: 'create' });
    });

    it('resumes a matching draft and reports the assets still to upload', () => {
        const draft = existingRelease({
            draft: true,
            assets: [{
                name: 'package.tgz',
                size: TARBALL.byteLength,
                digest: `sha256:${sha256Hex(TARBALL)}`,
            }],
        });
        const plan = planReleaseAction(draft, expectedRelease());
        expect(plan.action).toBe('resume');
        expect(plan.action === 'resume' ? plan.missing : []).toStrictEqual([
            'candidate.json',
            'release.json',
            'SHA256SUMS',
        ]);
    });

    it('resumes an empty draft', () => {
        const plan = planReleaseAction(existingRelease({ draft: true, assets: [] }), expectedRelease());
        expect(plan.action).toBe('resume');
        expect(plan.action === 'resume' ? plan.missing : []).toHaveLength(4);
    });

    it('is a successful no-op for a matching published release', () => {
        const plan = planReleaseAction(existingRelease(), expectedRelease());
        expect(plan.action).toBe('noop');
        expect(plan.action === 'noop' ? plan.release.id : 0).toBe(900);
    });

    it('is a hard failure when the published receipt differs', () => {
        const existing = existingRelease();
        existing.assets[1] = {
            name: 'candidate.json',
            size: 10,
            digest: `sha256:${'0'.repeat(64)}`,
        };
        const plan = planReleaseAction(existing, expectedRelease());
        expect(plan.action).toBe('conflict');
        expect(plan.action === 'conflict' ? plan.failures[0] : '')
            .toContain('different candidate receipt');
    });

    it('is a hard failure when a published asset differs', () => {
        const existing = existingRelease();
        existing.assets[0] = {
            name: 'package.tgz',
            size: 10,
            digest: `sha256:${'0'.repeat(64)}`,
        };
        const plan = planReleaseAction(existing, expectedRelease());
        expect(plan.action).toBe('conflict');
        expect(plan.action === 'conflict' ? plan.failures[0] : '')
            .toContain('different assets');
    });

    it('is a hard failure when a draft carries a conflicting asset', () => {
        const existing = existingRelease({ draft: true });
        existing.assets[0] = {
            name: 'package.tgz',
            size: 10,
            digest: `sha256:${'1'.repeat(64)}`,
        };
        expect(planReleaseAction(existing, expectedRelease()).action).toBe('conflict');
    });

    it('is a hard failure when the release carries an unexpected asset', () => {
        const existing = existingRelease();
        existing.assets.push({ name: 'extra.txt', size: 1, digest: `sha256:${'2'.repeat(64)}` });
        const plan = planReleaseAction(existing, expectedRelease());
        expect(plan.action).toBe('conflict');
        expect(plan.action === 'conflict' ? plan.failures.join(' ') : '')
            .toContain('unexpected asset extra.txt');
    });

    it('is a hard failure when a published release is missing assets', () => {
        const existing = existingRelease({ assets: [] });
        const plan = planReleaseAction(existing, expectedRelease());
        expect(plan.action).toBe('conflict');
        expect(plan.action === 'conflict' ? plan.failures.join(' ') : '')
            .toContain('is missing assets');
    });

    it('fails closed when an existing asset publishes no digest', () => {
        const existing = existingRelease();
        existing.assets[0] = { name: 'package.tgz', size: TARBALL.byteLength, digest: null };
        const plan = planReleaseAction(existing, expectedRelease());
        expect(plan.action).toBe('conflict');
        expect(plan.action === 'conflict' ? plan.failures.join(' ') : '')
            .toContain('publishes no digest');
    });

    it('never writes when the npm package is missing', () => {
        const plan = planReleaseAction(null, { ...expectedRelease(), npmPublic: 'missing' });
        expect(plan).toStrictEqual({
            action: 'conflict',
            critical: false,
            failures: ['the npm registry does not contain the released version.'],
        });
    });

    it('is a critical failure when the public npm bytes differ', () => {
        const plan = planReleaseAction(null, { ...expectedRelease(), npmPublic: 'bytes-differ' });
        expect(plan.action).toBe('conflict');
        expect(plan.action === 'conflict' ? plan.critical : false).toBe(true);
    });

    it('never writes when provenance is missing or invalid', () => {
        const plan = planReleaseAction(null, {
            ...expectedRelease(),
            provenanceVerified: false,
        });
        expect(plan).toStrictEqual({
            action: 'conflict',
            critical: false,
            failures: ['npm provenance is missing or invalid.'],
        });
    });
});

describe('release REST operations', () => {
    it('returns null for a tag without a release', async () => {
        const api = fakeApi(() => ({ status: 404, body: null }));
        await expect(getReleaseByTag(api.fetchJson, target(), TAG)).resolves.toBeNull();
        expect(api.calls[0]?.url)
            .toBe('https://api.github.com/repos/zsumz/demo/releases/tags/v1.2.3');
    });

    it('parses an existing release', async () => {
        const api = fakeApi(() => ({ status: 200, body: releaseBody(existingRelease()) }));
        await expect(getReleaseByTag(api.fetchJson, target(), TAG))
            .resolves.toStrictEqual(existingRelease());
    });

    it('throws on an unreadable release payload', async () => {
        const api = fakeApi(() => ({ status: 200, body: { id: 1 } }));
        await expect(getReleaseByTag(api.fetchJson, target(), TAG))
            .rejects.toThrow('unreadable release');
    });

    it('throws on an unexpected lookup status', async () => {
        const api = fakeApi(() => ({ status: 500, body: null }));
        await expect(getReleaseByTag(api.fetchJson, target(), TAG))
            .rejects.toThrow('returned 500');
    });

    it('creates a draft release', async () => {
        const draft = existingRelease({ draft: true, assets: [] });
        const api = fakeApi(() => ({ status: 201, body: releaseBody(draft) }));
        await expect(createDraftRelease(api.fetchJson, target(), {
            tag: TAG,
            name: TAG,
            body: 'notes',
            prerelease: false,
        })).resolves.toStrictEqual(draft);
        expect(api.calls[0]).toStrictEqual({
            url: 'https://api.github.com/repos/zsumz/demo/releases',
            method: 'POST',
        });
    });

    it('throws when draft creation fails', async () => {
        const api = fakeApi(() => ({ status: 422, body: null }));
        await expect(createDraftRelease(api.fetchJson, target(), {
            tag: TAG,
            name: TAG,
            body: 'notes',
            prerelease: false,
        })).rejects.toThrow('returned 422');
    });

    it('uploads an asset to the templated upload url', async () => {
        const api = fakeApi(() => ({ status: 201, body: {} }));
        const asset = uploads()[0];
        expect(asset).toBeDefined();
        if (asset === undefined) {
            return;
        }
        await uploadReleaseAsset(api.fetchJson, target(), existingRelease(), asset);
        expect(api.calls[0]).toStrictEqual({
            url: 'https://uploads.github.com/repos/zsumz/demo/releases/900/assets?name=package.tgz',
            method: 'POST',
        });
    });

    it('falls back to the upload base when the release has no template', async () => {
        const api = fakeApi(() => ({ status: 201, body: {} }));
        const asset = uploads()[1];
        expect(asset).toBeDefined();
        if (asset === undefined) {
            return;
        }
        await uploadReleaseAsset(
            api.fetchJson,
            target(),
            existingRelease({ uploadUrl: null }),
            asset,
        );
        expect(api.calls[0]?.url)
            .toBe('https://uploads.github.com/repos/zsumz/demo/releases/900/assets?name=candidate.json');
    });

    it('throws when an asset upload fails', async () => {
        const api = fakeApi(() => ({ status: 502, body: null }));
        const asset = uploads()[0];
        if (asset === undefined) {
            return;
        }
        await expect(uploadReleaseAsset(api.fetchJson, target(), existingRelease(), asset))
            .rejects.toThrow('returned 502');
    });

    it('publishes a draft', async () => {
        const api = fakeApi(() => ({ status: 200, body: releaseBody(existingRelease()) }));
        await expect(publishDraftRelease(
            api.fetchJson,
            target(),
            existingRelease({ draft: true }),
            false,
        )).resolves.toStrictEqual(existingRelease());
        expect(api.calls[0]).toStrictEqual({
            url: 'https://api.github.com/repos/zsumz/demo/releases/900',
            method: 'PATCH',
        });
    });
});

describe('publishReleaseBundle', () => {
    function bundleInput(fetchJson: FetchJson): Parameters<typeof publishReleaseBundle>[0] {
        return {
            fetchJson,
            target: target(),
            draft: { tag: TAG, name: TAG, body: 'notes', prerelease: false },
            assets: uploads(),
            npmPublic: 'verified',
            provenanceVerified: true,
        };
    }

    it('creates a draft, attaches every asset and publishes', async () => {
        const draft = existingRelease({ draft: true, assets: [] });
        const api = fakeApi((call) => {
            if (call.method === 'GET') {
                return { status: 404, body: null };
            }
            if (call.method === 'PATCH') {
                return { status: 200, body: releaseBody(existingRelease()) };
            }
            if (call.url.includes('/assets?name=')) {
                return { status: 201, body: {} };
            }
            return { status: 201, body: releaseBody(draft) };
        });
        await expect(publishReleaseBundle(bundleInput(api.fetchJson))).resolves.toStrictEqual({
            action: 'created',
            releaseId: 900,
            htmlUrl: 'https://github.com/zsumz/demo/releases/tag/v1.2.3',
        });
        expect(api.calls.map((call) => call.method))
            .toStrictEqual(['GET', 'POST', 'POST', 'POST', 'POST', 'POST', 'PATCH']);
    });

    it('resumes a draft without re-uploading matching assets', async () => {
        const draft = existingRelease({
            draft: true,
            assets: [{
                name: 'package.tgz',
                size: TARBALL.byteLength,
                digest: `sha256:${sha256Hex(TARBALL)}`,
            }],
        });
        const api = fakeApi((call) => {
            if (call.method === 'GET') {
                return { status: 200, body: releaseBody(draft) };
            }
            if (call.method === 'PATCH') {
                return { status: 200, body: releaseBody(existingRelease()) };
            }
            return { status: 201, body: {} };
        });
        const result = await publishReleaseBundle(bundleInput(api.fetchJson));
        expect(result.action).toBe('resumed');
        const uploaded = api.calls.filter((call) => call.url.includes('/assets?name='));
        expect(uploaded.map((call) => call.url.split('name=')[1])).toStrictEqual([
            'candidate.json',
            'release.json',
            'SHA256SUMS',
        ]);
    });

    it('is a successful no-op for a matching published release', async () => {
        const api = fakeApi(() => ({ status: 200, body: releaseBody(existingRelease()) }));
        await expect(publishReleaseBundle(bundleInput(api.fetchJson))).resolves.toStrictEqual({
            action: 'noop',
            releaseId: 900,
            htmlUrl: 'https://github.com/zsumz/demo/releases/tag/v1.2.3',
        });
        expect(api.calls).toHaveLength(1);
    });

    it('never overwrites a conflicting release', async () => {
        const conflicting = existingRelease();
        conflicting.assets[1] = {
            name: 'candidate.json',
            size: 3,
            digest: `sha256:${'0'.repeat(64)}`,
        };
        const api = fakeApi(() => ({ status: 200, body: releaseBody(conflicting) }));
        await expect(publishReleaseBundle(bundleInput(api.fetchJson)))
            .rejects.toThrow('different candidate receipt');
        expect(api.calls).toHaveLength(1);
    });

    it('refuses a release returned for another tag', async () => {
        const api = fakeApi(() => ({
            status: 200,
            body: releaseBody(existingRelease({ tagName: 'v9.9.9' })),
        }));
        await expect(publishReleaseBundle(bundleInput(api.fetchJson)))
            .rejects.toThrow('GitHub returned release v9.9.9 for tag v1.2.3');
    });

    it('never writes when the public npm bytes differ', async () => {
        const api = fakeApi(() => ({ status: 404, body: null }));
        await expect(publishReleaseBundle({
            ...bundleInput(api.fetchJson),
            npmPublic: 'bytes-differ',
        })).rejects.toThrow('public npm tarball bytes differ');
        expect(api.calls).toHaveLength(1);
    });
});
