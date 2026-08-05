import {
    readArrayProperty,
    readBooleanProperty,
    readNumberProperty,
    readStringProperty,
    type FetchJson,
    type FetchRequest,
} from '../../registry/download.ts';
import { GITHUB_API_VERSION, githubHeaders, type GithubApiTarget } from '../artifacts.ts';
import type {
    GithubReleaseTarget,
    ReleaseAssetUpload,
    ReleaseDraftInput,
    ReleaseState,
} from './model.ts';

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
