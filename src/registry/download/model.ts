import type { CandidateReceipt } from '../../candidate/receipt.ts';

// Injected effects. Every module in src/registry and src/github takes these as
// parameters so unit tests run offline against plain functions.
export interface FetchRequest {
    method: string;
    headers: Readonly<Record<string, string>>;
    body: string | Uint8Array | null;
}

export interface JsonResponse {
    status: number;
    body: unknown;
}

export interface BinaryResponse {
    status: number;
    body: Uint8Array;
}

export type FetchJson = (url: string, request?: FetchRequest) => Promise<JsonResponse>;
export type FetchBuffer = (url: string, request?: FetchRequest) => Promise<BinaryResponse>;

export interface RegistryFetch {
    fetchJson: FetchJson;
    fetchBuffer: FetchBuffer;
}

export interface RegistryLookup {
    registry: string;
    packageName: string;
}

export interface RegistryVersionMeta {
    version: string;
    tarball: string;
    integrity: string;
    shasum: string;
}

export type VersionMetaLookup =
    | { outcome: 'found'; meta: RegistryVersionMeta }
    | { outcome: 'absent' }
    | { outcome: 'malformed'; failures: string[] };

export interface RegistryStateInput {
    candidate: CandidateReceipt;
    packument: unknown;
    distTags: unknown;
    registry?: string;
}

export type RegistryState =
    | { state: 'converged'; versionMeta: RegistryVersionMeta }
    | { state: 'pending'; reason: string }
    | { state: 'mismatch'; failures: string[] };

// Design §11 Step C: bounded convergence wait, temporary states only.
export const retryPlan = {
    attempts: 30,
    intervalMs: 10_000,
    maxDurationMs: 300_000,
} as const;

export interface RegistryConvergenceInput {
    fetch: RegistryFetch;
    candidate: CandidateReceipt;
    sleep: (milliseconds: number) => Promise<void>;
    registry?: string;
}

export interface RegistryConvergence {
    state: RegistryState;
    attempts: number;
}
