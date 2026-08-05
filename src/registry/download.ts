import type { CandidateReceipt } from '../candidate/receipt.ts';

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

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

export function packumentUrl(registry: string, packageName: string): string {
    return `${registryRoot(registry)}/${encodePackageName(packageName)}`;
}

export function distTagsUrl(registry: string, packageName: string): string {
    return `${registryRoot(registry)}/-/package/${encodePackageName(packageName)}/dist-tags`;
}

export function attestationsUrl(
    registry: string,
    packageName: string,
    version: string,
): string {
    return `${registryRoot(registry)}/-/npm/v1/attestations/${encodePackageName(packageName)}@${version}`;
}

export function encodePackageName(packageName: string): string {
    return packageName.replace('/', '%2F');
}

export async function fetchPackument(
    fetchJson: FetchJson,
    lookup: RegistryLookup,
): Promise<unknown> {
    return fetchRegistryJson(fetchJson, packumentUrl(lookup.registry, lookup.packageName));
}

export async function fetchDistTags(
    fetchJson: FetchJson,
    lookup: RegistryLookup,
): Promise<unknown> {
    return fetchRegistryJson(fetchJson, distTagsUrl(lookup.registry, lookup.packageName));
}

export async function downloadTarball(
    fetchBuffer: FetchBuffer,
    url: string,
): Promise<Uint8Array> {
    const response = await fetchBuffer(url, registryGet());
    if (response.status !== 200) {
        throw new Error(`Registry download failed: ${url} returned ${String(response.status)}.`);
    }
    return response.body;
}

export function extractVersionMeta(
    packument: unknown,
    packageName: string,
    version: string,
): VersionMetaLookup {
    const documentName = readStringProperty(packument, 'name');
    if (documentName !== null && documentName !== packageName) {
        return {
            outcome: 'malformed',
            failures: [`Registry document is for ${documentName}, expected ${packageName}.`],
        };
    }
    const entry = readProperty(readProperty(packument, 'versions'), version);
    if (typeof entry !== 'object' || entry === null) {
        return { outcome: 'absent' };
    }
    const failures: string[] = [];
    const entryVersion = readStringProperty(entry, 'version');
    if (entryVersion !== null && entryVersion !== version) {
        failures.push(
            `Registry metadata for ${packageName}@${version} declares version ${entryVersion}.`,
        );
    }
    const dist = readProperty(entry, 'dist');
    const tarball = readStringProperty(dist, 'tarball');
    const integrity = readStringProperty(dist, 'integrity');
    const shasum = readStringProperty(dist, 'shasum');
    if (tarball === null) {
        failures.push(`Registry metadata for ${packageName}@${version} has no dist.tarball.`);
    }
    if (integrity === null) {
        failures.push(`Registry metadata for ${packageName}@${version} has no dist.integrity.`);
    }
    if (shasum === null) {
        failures.push(`Registry metadata for ${packageName}@${version} has no dist.shasum.`);
    }
    if (tarball === null || integrity === null || shasum === null || failures.length > 0) {
        return { outcome: 'malformed', failures };
    }
    return {
        outcome: 'found',
        meta: {
            version,
            tarball,
            integrity,
            shasum,
        },
    };
}

export function classifyRegistryState(input: RegistryStateInput): RegistryState {
    const registry = input.registry ?? DEFAULT_REGISTRY;
    const { candidate } = input;
    const packageName = candidate.package.name;
    const { version, distTag } = candidate.package;
    const lookup = extractVersionMeta(input.packument, packageName, version);
    if (lookup.outcome === 'malformed') {
        return { state: 'mismatch', failures: lookup.failures };
    }
    if (lookup.outcome === 'absent') {
        return {
            state: 'pending',
            reason: `${packageName}@${version} is not visible on ${registry} yet.`,
        };
    }
    const failures = permanentFailures(lookup.meta, candidate, registry);
    if (failures.length > 0) {
        return { state: 'mismatch', failures };
    }
    const tagged = readStringProperty(input.distTags, distTag);
    if (tagged === null) {
        return {
            state: 'pending',
            reason: `dist-tag ${distTag} is not visible for ${packageName} yet.`,
        };
    }
    // A later release may legitimately have moved the tag; that is only fatal
    // once the bounded convergence window is exhausted.
    if (tagged !== version) {
        return {
            state: 'pending',
            reason: `dist-tag ${distTag} points at ${tagged}, expected ${version}.`,
        };
    }
    return { state: 'converged', versionMeta: lookup.meta };
}

export function shouldContinue(attempt: number, state: RegistryState): boolean {
    if (state.state !== 'pending') {
        return false;
    }
    return attempt < retryPlan.attempts;
}

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

export async function awaitRegistryConvergence(
    input: RegistryConvergenceInput,
): Promise<RegistryConvergence> {
    const registry = input.registry ?? DEFAULT_REGISTRY;
    const lookup: RegistryLookup = { registry, packageName: input.candidate.package.name };
    let state: RegistryState = {
        state: 'pending',
        reason: 'the registry has not been queried yet.',
    };
    for (let attempt = 1; attempt <= retryPlan.attempts; attempt += 1) {
        state = await observeRegistryState(input.fetch, lookup, input.candidate, registry);
        if (!shouldContinue(attempt, state)) {
            return { state, attempts: attempt };
        }
        await input.sleep(retryPlan.intervalMs);
    }
    return { state, attempts: retryPlan.attempts };
}

// Shared unknown-narrowing helpers for every injected API payload in this area.
export function readProperty(value: unknown, key: string): unknown {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) {
        return undefined;
    }
    return (value as Record<string, unknown>)[key];
}

export function readStringProperty(value: unknown, key: string): string | null {
    const property = readProperty(value, key);
    return typeof property === 'string' ? property : null;
}

export function readNumberProperty(value: unknown, key: string): number | null {
    const property = readProperty(value, key);
    return typeof property === 'number' && Number.isFinite(property) ? property : null;
}

export function readBooleanProperty(value: unknown, key: string): boolean | null {
    const property = readProperty(value, key);
    return typeof property === 'boolean' ? property : null;
}

export function readArrayProperty(value: unknown, key: string): unknown[] | null {
    const property = readProperty(value, key);
    return Array.isArray(property) ? property : null;
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
}

// Thin default wiring; every other module takes the effects as parameters.
export function createRegistryFetch(): RegistryFetch {
    return {
        fetchJson: async (url, request) => {
            const response = await fetch(url, requestInit(request));
            const text = await response.text();
            return { status: response.status, body: parseJsonBody(text) };
        },
        fetchBuffer: async (url, request) => {
            const response = await fetch(url, requestInit(request));
            const body = new Uint8Array(await response.arrayBuffer());
            return { status: response.status, body };
        },
    };
}

function requestInit(request: FetchRequest | undefined): RequestInit {
    if (request === undefined) {
        return { method: 'GET' };
    }
    return {
        method: request.method,
        headers: { ...request.headers },
        body: bodyInit(request.body),
    };
}

function bodyInit(body: string | Uint8Array | null): BodyInit | null {
    if (body === null || typeof body === 'string') {
        return body;
    }
    return body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
    ) as ArrayBuffer;
}

function parseJsonBody(text: string): unknown {
    if (text.length === 0) {
        return null;
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return null;
    }
}

async function fetchRegistryJson(fetchJson: FetchJson, url: string): Promise<unknown> {
    const response = await fetchJson(url, registryGet());
    if (response.status === 404) {
        return null;
    }
    if (response.status !== 200) {
        throw new Error(`Registry request failed: ${url} returned ${String(response.status)}.`);
    }
    return response.body;
}

async function observeRegistryState(
    registryFetch: RegistryFetch,
    lookup: RegistryLookup,
    candidate: CandidateReceipt,
    registry: string,
): Promise<RegistryState> {
    try {
        const packument = await fetchPackument(registryFetch.fetchJson, lookup);
        const distTags = await fetchDistTags(registryFetch.fetchJson, lookup);
        return classifyRegistryState({
            candidate,
            packument,
            distTags,
            registry,
        });
    } catch (error) {
        return { state: 'pending', reason: `registry query failed: ${errorMessage(error)}` };
    }
}

function permanentFailures(
    meta: RegistryVersionMeta,
    candidate: CandidateReceipt,
    registry: string,
): string[] {
    const failures: string[] = [];
    if (meta.integrity !== candidate.tarball.integrity) {
        failures.push(
            `Registry integrity ${meta.integrity} does not match candidate ${candidate.tarball.integrity}.`,
        );
    }
    const tarballOrigin = urlOrigin(meta.tarball);
    const registryOrigin = urlOrigin(registry);
    if (tarballOrigin === null) {
        failures.push(`Registry tarball URL is not usable: ${meta.tarball}.`);
    } else if (registryOrigin !== null && tarballOrigin !== registryOrigin) {
        failures.push(
            `Registry tarball origin ${tarballOrigin} does not match ${registryOrigin}.`,
        );
    }
    return failures;
}

function urlOrigin(value: string): string | null {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

function registryRoot(registry: string): string {
    return registry.endsWith('/') ? registry.slice(0, -1) : registry;
}

function registryGet(): FetchRequest {
    return {
        method: 'GET',
        headers: { accept: 'application/json' },
        body: null,
    };
}
