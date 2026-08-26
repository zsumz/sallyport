import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
    PackageMetadata,
    ReleaseMetadata,
    ReleasePackageMetadata,
} from './model.ts';
import { readPackageMetadata } from './read.ts';

export async function readReleaseMetadata(dir: string): Promise<ReleaseMetadata> {
    const root = await readPackageMetadata(dir);
    const manifest = await readJson(path.join(dir, 'package.json'));
    const lock = await readJson(path.join(dir, 'package-lock.json'));
    const configured = packageDirectories(property(manifest, 'sallyport'));
    if (configured === undefined) {
        return singleRelease(root, manifest);
    }
    if (configured === null) {
        return invalidFamily(root);
    }
    const configurationFailures = directoryFailures(configured);
    const packages: ReleasePackageMetadata[] = [];
    for (const directory of configured) {
        const normalized = path.posix.normalize(directory);
        if (directory === '' || directory.startsWith('/') || directory.includes('\\')
            || normalized !== directory || directory === '.' || directory.startsWith('../')) {
            continue;
        }
        const packageManifest = await readJson(path.join(dir, directory, 'package.json'));
        if (packageManifest === undefined) {
            configurationFailures.push(
                directory + '/package.json is missing or is not valid json.',
            );
            continue;
        }
        const lockEntry = property(property(lock, 'packages'), directory);
        packages.push({
            ...metadata(packageManifest, lock, lockEntry),
            directory,
            repositoryDirectory: stringProperty(
                property(packageManifest, 'repository'),
                'directory',
            ),
        });
    }
    return { root, packages, isFamily: true, configurationFailures };
}

function singleRelease(root: PackageMetadata, manifest: unknown): ReleaseMetadata {
    return {
        root,
        packages: [{
            ...root,
            directory: '',
            repositoryDirectory: stringProperty(property(manifest, 'repository'), 'directory'),
        }],
        isFamily: false,
        configurationFailures: [],
    };
}

function invalidFamily(root: PackageMetadata): ReleaseMetadata {
    return {
        root,
        packages: [],
        isFamily: true,
        configurationFailures: [
            'package.json sallyport.packages must list at least two safe relative directories.',
        ],
    };
}

function packageDirectories(sallyport: unknown): readonly string[] | null | undefined {
    const value = property(sallyport, 'packages');
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length < 2
        || !value.every((entry) => typeof entry === 'string')) {
        return null;
    }
    return value;
}

function directoryFailures(directories: readonly string[]): string[] {
    const failures: string[] = [];
    const seen: Set<string> = new Set();
    for (const directory of directories) {
        const normalized = path.posix.normalize(directory);
        if (directory === '' || directory.startsWith('/') || directory.includes('\\')
            || normalized !== directory || directory === '.' || directory.startsWith('../')) {
            failures.push(
                'sallyport package directory ' + JSON.stringify(directory)
                + ' must be a safe normalized relative path.',
            );
        } else if (seen.has(directory)) {
            failures.push('sallyport package directory ' + directory + ' is listed more than once.');
        }
        seen.add(directory);
    }
    return failures;
}

function metadata(manifest: unknown, lock: unknown, lockEntry: unknown): PackageMetadata {
    const publish = property(manifest, 'publishConfig');
    return {
        name: stringProperty(manifest, 'name'),
        version: stringProperty(manifest, 'version'),
        isPrivate: Boolean(property(manifest, 'private')),
        hasWorkspaces: property(manifest, 'workspaces') !== undefined,
        publishAccess: stringProperty(publish, 'access'),
        publishProvenance: booleanProperty(publish, 'provenance'),
        repositoryUrl: repositoryUrl(manifest),
        requiredStatusChecks: undefined,
        hasLockfile: lock !== undefined,
        lockName: stringProperty(lockEntry, 'name'),
        lockVersion: stringProperty(lockEntry, 'version'),
        lockRootName: stringProperty(lockEntry, 'name'),
        lockRootVersion: stringProperty(lockEntry, 'version'),
    };
}

async function readJson(file: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(file, 'utf8')) as unknown;
    } catch {
        return undefined;
    }
}

function property(value: unknown, key: string): unknown {
    return typeof value === 'object' && value !== null && key in value
        ? value[key as keyof typeof value]
        : undefined;
}

function stringProperty(value: unknown, key: string): string | undefined {
    const found = property(value, key);
    return typeof found === 'string' ? found : undefined;
}

function booleanProperty(value: unknown, key: string): boolean | undefined {
    const found = property(value, key);
    return typeof found === 'boolean' ? found : undefined;
}

function repositoryUrl(manifest: unknown): string | undefined {
    const repository = property(manifest, 'repository');
    return typeof repository === 'string' ? repository : stringProperty(repository, 'url');
}
