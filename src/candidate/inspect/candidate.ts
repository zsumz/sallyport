import {
    CANDIDATE_MANIFEST_PATH,
    CANDIDATE_ROOT_DIRECTORY,
    type CandidateTarballInspection,
    type CandidateTarballManifest,
    type TarEntry,
} from './model.ts';
import { readTarballRecords, type TarRecord } from './tar.ts';

const NUL_CHARACTER = String.fromCharCode(0);

export function inspectCandidateTarball(buffer: Buffer): CandidateTarballInspection {
    let records: TarRecord[];
    try {
        records = readTarballRecords(buffer);
    } catch (error) {
        return { name: null, version: null, files: [], failures: [errorMessage(error)] };
    }

    const files = records.map((record) => record.entry);
    const failures = files
        .map(entrySafetyFailure)
        .filter((failure): failure is string => failure !== null);

    const manifest = records.find((record) => record.entry.path === CANDIDATE_MANIFEST_PATH);
    if (manifest === undefined) {
        failures.push(`Tarball does not contain ${CANDIDATE_MANIFEST_PATH}.`);
        return { name: null, version: null, files, failures };
    }
    if (manifest.entry.type !== 'file') {
        failures.push(`${CANDIDATE_MANIFEST_PATH} must be a regular file.`);
        return { name: null, version: null, files, failures };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(manifest.data.toString('utf8'));
    } catch (error) {
        failures.push(`${CANDIDATE_MANIFEST_PATH} is not valid JSON: ${errorMessage(error)}`);
        return { name: null, version: null, files, failures };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        failures.push(`${CANDIDATE_MANIFEST_PATH} must contain a JSON object.`);
        return { name: null, version: null, files, failures };
    }

    const name = readManifestString(parsed, 'name');
    const version = readManifestString(parsed, 'version');
    if (name === null) {
        failures.push(`${CANDIDATE_MANIFEST_PATH} must contain a nonempty string name.`);
    }
    if (version === null) {
        failures.push(`${CANDIDATE_MANIFEST_PATH} must contain a nonempty string version.`);
    }
    return { name, version, files, failures };
}

export function assertCandidateTarball(buffer: Buffer): CandidateTarballManifest {
    const inspection = inspectCandidateTarball(buffer);
    if (inspection.failures.length > 0) {
        throw new Error(`Candidate tarball is invalid:\n${inspection.failures.join('\n')}`);
    }
    if (inspection.name === null || inspection.version === null) {
        throw new Error(`Candidate tarball is invalid: ${CANDIDATE_MANIFEST_PATH} is incomplete.`);
    }
    return { name: inspection.name, version: inspection.version, files: inspection.files };
}

// Every packed path is attacker-controlled input; only plain files under package/ are acceptable.
function entrySafetyFailure(entry: TarEntry): string | null {
    const { path } = entry;
    const label = JSON.stringify(path);
    if (path === '') {
        return 'Tarball contains an entry with an empty path.';
    }
    if (path.includes(NUL_CHARACTER)) {
        return `Tarball entry ${label} contains a null byte.`;
    }
    if (path.includes('\\')) {
        return `Tarball entry ${label} contains a backslash.`;
    }
    if (path.startsWith('/')) {
        return `Tarball entry ${label} is an absolute path.`;
    }
    if (/^[A-Za-z]:/.test(path)) {
        return `Tarball entry ${label} is a drive-qualified path.`;
    }
    const normalized = path.endsWith('/') ? path.slice(0, -1) : path;
    for (const segment of normalized.split('/')) {
        if (segment === '') {
            return `Tarball entry ${label} contains an empty path segment.`;
        }
        if (segment === '.' || segment === '..') {
            return `Tarball entry ${label} contains a relative path segment.`;
        }
    }
    if (
        normalized !== CANDIDATE_ROOT_DIRECTORY
        && !normalized.startsWith(`${CANDIDATE_ROOT_DIRECTORY}/`)
    ) {
        return `Tarball entry ${label} is outside ${CANDIDATE_ROOT_DIRECTORY}/.`;
    }
    if (entry.type === 'other') {
        return `Tarball entry ${label} is not a regular file or directory.`;
    }
    return null;
}

function readManifestString(manifest: object, key: string): string | null {
    if (!(key in manifest)) {
        return null;
    }
    const value: unknown = manifest[key as keyof typeof manifest];
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }
    return value;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
