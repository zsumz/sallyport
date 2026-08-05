import type { FetchBuffer, FetchJson } from '../../registry/download.ts';

export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';
export const CANDIDATE_TARBALL_NAME = 'package.tgz';
export const CANDIDATE_RECEIPT_NAME = 'candidate.json';

export interface GithubApiTarget {
    apiBase: string;
    repository: string;
    token: string;
}

export interface RunArtifact {
    id: number;
    name: string;
    expired: boolean;
    sizeInBytes: number;
    archiveDownloadUrl: string;
}

export interface ZipEntry {
    name: string;
    data: Uint8Array;
}

export interface CandidateArtifactFiles {
    tarball: Uint8Array;
    receipt: Uint8Array;
}

export interface CandidateArtifactInput {
    fetchJson: FetchJson;
    fetchBuffer: FetchBuffer;
    target: GithubApiTarget;
    runId: number;
    runAttempt: number;
    commit: string;
}
