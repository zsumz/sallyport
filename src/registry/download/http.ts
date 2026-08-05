import type {
    FetchBuffer,
    FetchJson,
    FetchRequest,
    RegistryFetch,
    RegistryLookup,
} from './model.ts';
import { distTagsUrl, packumentUrl } from './urls.ts';

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

function registryGet(): FetchRequest {
    return {
        method: 'GET',
        headers: { accept: 'application/json' },
        body: null,
    };
}
