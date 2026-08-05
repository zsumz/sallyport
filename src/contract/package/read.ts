import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { PackageMetadata } from './model.ts';

export async function readPackageMetadata(dir: string): Promise<PackageMetadata> {
    const manifestFile = path.join(dir, 'package.json');
    const manifest = await readJsonFile(manifestFile);
    if (manifest === undefined) {
        throw new Error(
            `Package metadata failed: ${manifestFile} is missing or is not valid json.`,
        );
    }
    const lock = await readJsonFile(path.join(dir, 'package-lock.json'));
    const lockRoot = readProperty(readProperty(lock, 'packages'), '');
    const publishConfig = readProperty(manifest, 'publishConfig');
    const workspaces = readProperty(manifest, 'workspaces');
    return {
        name: readString(manifest, 'name'),
        version: readString(manifest, 'version'),
        isPrivate: Boolean(readProperty(manifest, 'private')),
        hasWorkspaces: workspaces !== undefined && workspaces !== null,
        publishAccess: readString(publishConfig, 'access'),
        publishProvenance: readBoolean(publishConfig, 'provenance'),
        repositoryUrl: readRepositoryUrl(manifest),
        hasLockfile: lock !== undefined,
        lockName: readString(lock, 'name'),
        lockVersion: readString(lock, 'version'),
        lockRootName: readString(lockRoot, 'name'),
        lockRootVersion: readString(lockRoot, 'version'),
    };
}

async function readJsonFile(file: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(file, 'utf8')) as unknown;
    } catch {
        return undefined;
    }
}

function readProperty(value: unknown, key: string): unknown {
    return typeof value === 'object' && value !== null && key in value
        ? value[key as keyof typeof value]
        : undefined;
}

function readString(value: unknown, key: string): string | undefined {
    const property = readProperty(value, key);
    return typeof property === 'string' ? property : undefined;
}

function readBoolean(value: unknown, key: string): boolean | undefined {
    const property = readProperty(value, key);
    if (typeof property === 'boolean') {
        return property;
    }
    if (property === 'true' || property === 'false') {
        return property === 'true';
    }
    return undefined;
}

function readRepositoryUrl(manifest: unknown): string | undefined {
    const repository = readProperty(manifest, 'repository');
    return typeof repository === 'string'
        ? repository
        : readString(repository, 'url');
}
