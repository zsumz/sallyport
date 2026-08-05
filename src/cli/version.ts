import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readStringField } from './support.ts';

// Resolved from this module, so the same code reads the package manifest when
// running from src/ during development and from dist/ once published.
const MANIFEST_URL = new URL('../../package.json', import.meta.url);

export function sallyportManifestPath(): string {
    return fileURLToPath(MANIFEST_URL);
}

export async function readsallyportVersion(): Promise<string> {
    const file = sallyportManifestPath();
    let parsed: unknown;
    try {
        parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    } catch {
        throw new Error(`Version lookup failed: ${file} is missing or is not valid json.`);
    }
    const version = readStringField(parsed, 'version');
    if (version === null || version.trim() === '') {
        throw new Error(`Version lookup failed: ${file} declares no version.`);
    }
    return version;
}
