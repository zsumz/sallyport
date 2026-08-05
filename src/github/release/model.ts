import type { NpmPublicState } from '../../contract/release.ts';
import type { FetchJson } from '../../registry/download.ts';
import type { GithubApiTarget } from '../artifacts.ts';

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
