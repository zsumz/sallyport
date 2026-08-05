import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { releaseNotesPath } from './release.ts';
import { parseSemver, releaseTagForVersion } from './semver.ts';

export interface PackageMetadata {
    name: string | undefined;
    version: string | undefined;
    isPrivate: boolean;
    hasWorkspaces: boolean;
    publishAccess: string | undefined;
    publishProvenance: boolean | undefined;
    repositoryUrl: string | undefined;
    hasLockfile: boolean;
    lockName: string | undefined;
    lockVersion: string | undefined;
    lockRootName: string | undefined;
    lockRootVersion: string | undefined;
}

export interface PackageContractInput extends PackageMetadata {
    tag: string;
    expectedRepository: string;
    registryHasVersion: boolean;
    hasReleaseNotes: boolean;
}

const GITHUB_URL_PATTERN =
    /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?(?:www\.)?github\.com\/(.+)$/u;
const GITHUB_SCP_PATTERN = /^(?:[^@/]+@)?github\.com:(.+)$/u;
const GITHUB_SHORTHAND_PATTERN = /^github:(.+)$/u;
const REPOSITORY_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;
const BARE_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;

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

export function validatePackageContract(input: PackageContractInput): string[] {
    const failures: string[] = [];
    const { name, version } = input;
    if (name === undefined || name.trim() === '') {
        failures.push('package.json must declare a name.');
    }
    if (input.isPrivate) {
        failures.push('package.json must not mark the package private.');
    }
    if (input.hasWorkspaces) {
        failures.push(
            'package.json must not declare workspaces; quoin releases one root package.',
        );
    }
    if (version === undefined || parseSemver(version) === null) {
        failures.push(
            'package version must be valid semantic versioning without build metadata.',
        );
    }
    if (version === undefined || input.tag !== releaseTagForVersion(version)) {
        failures.push('release tag must exactly match v<package version>.');
    }
    failures.push(...accessFailures(input));
    if (input.publishProvenance === false) {
        failures.push('publishConfig.provenance must not be disabled.');
    }
    failures.push(...repositoryFailures(input));
    failures.push(...lockfileFailures(input));
    if (input.registryHasVersion) {
        failures.push(
            `the npm registry already contains ${describeRelease(name, version)}.`,
        );
    }
    if (!input.hasReleaseNotes) {
        failures.push(version === undefined
            ? 'committed release notes must exist.'
            : `${releaseNotesPath(version)} must contain release notes.`);
    }
    return failures;
}

export function normalizeRepositoryUrl(url: string): string | null {
    const source = url.trim().replace(/^git\+/u, '');
    const withoutQuery = source.split('#')[0]?.split('?')[0] ?? '';
    const repositoryPath = githubPath(withoutQuery);
    if (repositoryPath === null) {
        return null;
    }
    const segments = repositoryPath
        .replace(/\/+$/u, '')
        .replace(/\.git$/u, '')
        .replace(/\/+$/u, '')
        .split('/');
    if (segments.length !== 2) {
        return null;
    }
    const [owner, name] = segments;
    if (owner === undefined || name === undefined) {
        return null;
    }
    if (
        !REPOSITORY_SEGMENT_PATTERN.test(owner)
        || !REPOSITORY_SEGMENT_PATTERN.test(name)
    ) {
        return null;
    }
    if (isRelativeSegment(owner) || isRelativeSegment(name)) {
        return null;
    }
    return `${owner}/${name}`;
}

function accessFailures(input: PackageContractInput): string[] {
    const { publishAccess } = input;
    if (publishAccess === undefined) {
        return input.name?.startsWith('@') === true
            ? ['scoped packages must set publishConfig.access to public.']
            : [];
    }
    return publishAccess === 'public'
        ? []
        : [`publishConfig.access must be public, found ${publishAccess}.`];
}

function repositoryFailures(input: PackageContractInput): string[] {
    const { repositoryUrl } = input;
    if (repositoryUrl === undefined || repositoryUrl.trim() === '') {
        return ['package.json must declare a repository url.'];
    }
    const repository = normalizeRepositoryUrl(repositoryUrl);
    if (repository === null) {
        return [
            `repository url ${repositoryUrl} must identify a github.com repository.`,
        ];
    }
    const expected = normalizeRepositoryUrl(input.expectedRepository)
        ?? input.expectedRepository;
    if (repository.toLowerCase() !== expected.toLowerCase()) {
        return [`package.json repository ${repository} must be ${expected}.`];
    }
    return [];
}

function lockfileFailures(input: PackageContractInput): string[] {
    if (!input.hasLockfile) {
        return ['package-lock.json must exist.'];
    }
    const failures: string[] = [];
    if (input.lockName !== input.name || input.lockRootName !== input.name) {
        failures.push('package-lock.json names must match package.json.');
    }
    if (
        input.lockVersion !== input.version
        || input.lockRootVersion !== input.version
    ) {
        failures.push('package-lock.json versions must match package.json.');
    }
    return failures;
}

function githubPath(value: string): string | null {
    const url = GITHUB_URL_PATTERN.exec(value);
    if (url !== null) {
        return url[1] ?? null;
    }
    const scp = GITHUB_SCP_PATTERN.exec(value);
    if (scp !== null) {
        return scp[1] ?? null;
    }
    const shorthand = GITHUB_SHORTHAND_PATTERN.exec(value);
    if (shorthand !== null) {
        return shorthand[1] ?? null;
    }
    return BARE_REPOSITORY_PATTERN.test(value) ? value : null;
}

function isRelativeSegment(segment: string): boolean {
    return segment === '.' || segment === '..';
}

function describeRelease(
    name: string | undefined,
    version: string | undefined,
): string {
    return name === undefined || version === undefined
        ? 'this version'
        : `${name}@${version}`;
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
