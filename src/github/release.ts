import {
    replayDecision,
    type NpmPublicState,
    type ReplayDecision,
} from '../contract/release.ts';
import {
    readArrayProperty,
    readBooleanProperty,
    readNumberProperty,
    readStringProperty,
    type FetchJson,
    type FetchRequest,
} from '../registry/download.ts';
import { sha256Hex } from '../registry/integrity.ts';
import { GITHUB_API_VERSION, githubHeaders, type GithubApiTarget } from './artifacts.ts';

export const GITHUB_UPLOAD_BASE = 'https://uploads.github.com';
export const RECEIPT_ASSET_NAMES = ['candidate.json', 'release.json'] as const;

export interface GithubReleaseTarget extends GithubApiTarget {
    uploadBase: string;
}

export interface ReleaseAssetState {
    name: string;
    size: number;
    digest: string | null;
}

export interface ReleaseState {
    id: number;
    tagName: string;
    draft: boolean;
    htmlUrl: string;
    uploadUrl: string | null;
    assets: ReleaseAssetState[];
}

export interface ExpectedAsset {
    name: string;
    sha256: string;
}

export interface ExpectedRelease {
    tag: string;
    assets: readonly ExpectedAsset[];
    npmPublic: NpmPublicState;
    provenanceVerified: boolean;
}

export type ReleasePlan =
    | { action: 'create' }
    | { action: 'resume'; release: ReleaseState; missing: string[] }
    | { action: 'noop'; release: ReleaseState }
    | { action: 'conflict'; critical: boolean; failures: string[] };

export interface ReleaseAssetUpload {
    name: string;
    contentType: string;
    data: Uint8Array;
}

export interface ReleaseDraftInput {
    tag: string;
    name: string;
    body: string;
    prerelease: boolean;
}

export interface ReleaseBundleInput {
    fetchJson: FetchJson;
    target: GithubReleaseTarget;
    draft: ReleaseDraftInput;
    assets: readonly ReleaseAssetUpload[];
    npmPublic: NpmPublicState;
    provenanceVerified: boolean;
}

export interface ReleasePublication {
    action: 'created' | 'resumed' | 'noop';
    releaseId: number;
    htmlUrl: string;
}

export async function getReleaseByTag(
    fetchJson: FetchJson,
    target: GithubApiTarget,
    tag: string,
): Promise<ReleaseState | null> {
    const url = `${apiRoot(target.apiBase)}/repos/${target.repository}/releases/tags/${encodeURIComponent(tag)}`;
    const response = await fetchJson(url, jsonRequest(target.token, 'GET', null));
    if (response.status === 404) {
        return null;
    }
    if (response.status !== 200) {
        throw new Error(`GitHub request failed: ${url} returned ${String(response.status)}.`);
    }
    return parseReleaseState(response.body, url);
}

export async function createDraftRelease(
    fetchJson: FetchJson,
    target: GithubApiTarget,
    draft: ReleaseDraftInput,
): Promise<ReleaseState> {
    const url = `${apiRoot(target.apiBase)}/repos/${target.repository}/releases`;
    const body = JSON.stringify({
        tag_name: draft.tag,
        name: draft.name,
        body: draft.body,
        draft: true,
        prerelease: draft.prerelease,
    });
    const response = await fetchJson(url, jsonRequest(target.token, 'POST', body));
    if (response.status !== 201) {
        throw new Error(`GitHub release creation failed: ${url} returned ${String(response.status)}.`);
    }
    return parseReleaseState(response.body, url);
}

export async function uploadReleaseAsset(
    fetchJson: FetchJson,
    target: GithubReleaseTarget,
    release: ReleaseState,
    asset: ReleaseAssetUpload,
): Promise<void> {
    const url = assetUploadUrl(target, release, asset.name);
    const response = await fetchJson(url, {
        method: 'POST',
        headers: {
            ...githubHeaders(target.token),
            'content-type': asset.contentType,
            'content-length': String(asset.data.byteLength),
        },
        body: asset.data,
    });
    if (response.status !== 201) {
        throw new Error(
            `GitHub asset upload failed: ${asset.name} returned ${String(response.status)}.`,
        );
    }
}

export async function publishDraftRelease(
    fetchJson: FetchJson,
    target: GithubApiTarget,
    release: ReleaseState,
    prerelease: boolean,
): Promise<ReleaseState> {
    const url = `${apiRoot(target.apiBase)}/repos/${target.repository}/releases/${String(release.id)}`;
    const body = JSON.stringify({
        draft: false,
        prerelease,
        make_latest: prerelease ? 'false' : 'true',
    });
    const response = await fetchJson(url, jsonRequest(target.token, 'PATCH', body));
    if (response.status !== 200) {
        throw new Error(`GitHub release publication failed: ${url} returned ${String(response.status)}.`);
    }
    return parseReleaseState(response.body, url);
}

// Design §12. The replay table itself lives in src/contract/release.ts; this is
// the adapter that turns observed GitHub state into that table's inputs.
export function planReleaseAction(
    existing: ReleaseState | null,
    expected: ExpectedRelease,
): ReleasePlan {
    if (existing === null) {
        const decision = replayDecision({
            githubRelease: 'none',
            receiptMatches: true,
            assetsMatch: true,
            npmPublic: expected.npmPublic,
            provenanceVerified: expected.provenanceVerified,
        });
        if (decision.action === 'create-draft-and-publish') {
            return { action: 'create' };
        }
        return conflictPlan(decision, []);
    }
    const comparison = compareAssets(existing, expected);
    const decision = replayDecision({
        githubRelease: existing.draft ? 'draft' : 'published',
        receiptMatches: comparison.receiptMatches,
        assetsMatch: comparison.assetsMatch,
        npmPublic: expected.npmPublic,
        provenanceVerified: expected.provenanceVerified,
    });
    switch (decision.action) {
        case 'resume-draft-and-publish':
            return { action: 'resume', release: existing, missing: comparison.missing };
        case 'noop-already-released':
            return { action: 'noop', release: existing };
        case 'create-draft-and-publish':
        case 'fail':
            return conflictPlan(decision, comparison.failures);
    }
}

// Draft-first publication. Conflicts are hard failures: nothing is ever
// deleted, overwritten, or republished.
export async function publishReleaseBundle(
    input: ReleaseBundleInput,
): Promise<ReleasePublication> {
    const expected: ExpectedRelease = {
        tag: input.draft.tag,
        assets: input.assets.map((asset) => ({
            name: asset.name,
            sha256: sha256Hex(asset.data),
        })),
        npmPublic: input.npmPublic,
        provenanceVerified: input.provenanceVerified,
    };
    const existing = await getReleaseByTag(input.fetchJson, input.target, input.draft.tag);
    if (existing !== null && existing.tagName !== input.draft.tag) {
        throw new Error(
            `Release publication failed: GitHub returned release ${existing.tagName} for tag ${input.draft.tag}.`,
        );
    }
    const plan = planReleaseAction(existing, expected);
    switch (plan.action) {
        case 'conflict':
            throw new Error(
                `Release publication failed: ${plan.failures.join(' ')}`,
            );
        case 'noop':
            return {
                action: 'noop',
                releaseId: plan.release.id,
                htmlUrl: plan.release.htmlUrl,
            };
        case 'create': {
            const created = await createDraftRelease(
                input.fetchJson,
                input.target,
                input.draft,
            );
            const published = await uploadAndPublish(input, created, input.assets);
            return { action: 'created', releaseId: published.id, htmlUrl: published.htmlUrl };
        }
        case 'resume': {
            const pending = input.assets.filter(
                (asset) => plan.missing.includes(asset.name),
            );
            const published = await uploadAndPublish(input, plan.release, pending);
            return { action: 'resumed', releaseId: published.id, htmlUrl: published.htmlUrl };
        }
    }
}

interface AssetComparison {
    receiptMatches: boolean;
    assetsMatch: boolean;
    missing: string[];
    failures: string[];
}

function compareAssets(existing: ReleaseState, expected: ExpectedRelease): AssetComparison {
    const wanted = new Map(
        expected.assets.map((asset) => [asset.name, asset.sha256.toLowerCase()]),
    );
    const comparison: AssetComparison = {
        receiptMatches: true,
        assetsMatch: true,
        missing: [],
        failures: [],
    };
    const present: string[] = [];
    for (const asset of existing.assets) {
        const want = wanted.get(asset.name);
        if (want === undefined) {
            comparison.assetsMatch = false;
            comparison.failures.push(
                `Release ${existing.tagName} carries unexpected asset ${asset.name}.`,
            );
            continue;
        }
        const digest = normalizeDigest(asset.digest);
        if (digest === null) {
            recordMismatch(
                comparison,
                asset.name,
                `Release ${existing.tagName} asset ${asset.name} publishes no digest to compare.`,
            );
            continue;
        }
        if (digest !== want) {
            recordMismatch(
                comparison,
                asset.name,
                `Release ${existing.tagName} asset ${asset.name} has digest ${digest}, expected ${want}.`,
            );
            continue;
        }
        present.push(asset.name);
    }
    comparison.missing = expected.assets
        .map((asset) => asset.name)
        .filter((name) => !present.includes(name));
    if (!existing.draft && comparison.missing.length > 0) {
        comparison.assetsMatch = false;
        comparison.failures.push(
            `Published release ${existing.tagName} is missing assets: ${comparison.missing.join(', ')}.`,
        );
    }
    return comparison;
}

function recordMismatch(
    comparison: AssetComparison,
    name: string,
    failure: string,
): void {
    if (isReceiptAsset(name)) {
        comparison.receiptMatches = false;
    } else {
        comparison.assetsMatch = false;
    }
    comparison.failures.push(failure);
}

function isReceiptAsset(name: string): boolean {
    return RECEIPT_ASSET_NAMES.some((receipt) => receipt === name);
}

function conflictPlan(decision: ReplayDecision, details: readonly string[]): ReleasePlan {
    const reason = decision.action === 'fail'
        ? decision.reason
        : `unexpected replay decision ${decision.action}.`;
    return {
        action: 'conflict',
        critical: decision.action === 'fail' && (decision.critical ?? false),
        failures: [reason, ...details],
    };
}

async function uploadAndPublish(
    input: ReleaseBundleInput,
    release: ReleaseState,
    assets: readonly ReleaseAssetUpload[],
): Promise<ReleaseState> {
    for (const asset of assets) {
        await uploadReleaseAsset(input.fetchJson, input.target, release, asset);
    }
    return publishDraftRelease(
        input.fetchJson,
        input.target,
        release,
        input.draft.prerelease,
    );
}

function parseReleaseState(body: unknown, url: string): ReleaseState {
    const id = readNumberProperty(body, 'id');
    const tagName = readStringProperty(body, 'tag_name');
    const draft = readBooleanProperty(body, 'draft');
    if (id === null || tagName === null || draft === null) {
        throw new Error(`GitHub returned an unreadable release from ${url}.`);
    }
    return {
        id,
        tagName,
        draft,
        htmlUrl: readStringProperty(body, 'html_url') ?? '',
        uploadUrl: readStringProperty(body, 'upload_url'),
        assets: (readArrayProperty(body, 'assets') ?? []).map((asset) => ({
            name: readStringProperty(asset, 'name') ?? '',
            size: readNumberProperty(asset, 'size') ?? 0,
            digest: readStringProperty(asset, 'digest'),
        })),
    };
}

function normalizeDigest(digest: string | null): string | null {
    if (digest === null) {
        return null;
    }
    const value = digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : digest;
    return /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function assetUploadUrl(
    target: GithubReleaseTarget,
    release: ReleaseState,
    name: string,
): string {
    const template = release.uploadUrl;
    const base = !template?.startsWith('http')
        ? `${apiRoot(target.uploadBase)}/repos/${target.repository}/releases/${String(release.id)}/assets`
        : template.replace(/\{[^}]*\}$/, '');
    return `${base}?name=${encodeURIComponent(name)}`;
}

function jsonRequest(token: string, method: string, body: string | null): FetchRequest {
    return {
        method,
        headers: {
            ...githubHeaders(token),
            'content-type': 'application/json',
            'x-github-api-version': GITHUB_API_VERSION,
        },
        body,
    };
}

function apiRoot(base: string): string {
    return base.endsWith('/') ? base.slice(0, -1) : base;
}
