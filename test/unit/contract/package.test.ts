import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
    type PackageContractInput,
    normalizeRepositoryUrl,
    readPackageMetadata,
    validatePackageContract,
} from '../../../src/contract/package.ts';

const baseInput: PackageContractInput = {
    tag: 'v0.1.2',
    expectedRepository: 'zsumz/smoque',
    name: 'smoque',
    version: '0.1.2',
    isPrivate: false,
    hasWorkspaces: false,
    publishAccess: 'public',
    publishProvenance: undefined,
    repositoryUrl: 'git+https://github.com/zsumz/smoque.git',
    hasLockfile: true,
    lockName: 'smoque',
    lockVersion: '0.1.2',
    lockRootName: 'smoque',
    lockRootVersion: '0.1.2',
    registryHasVersion: false,
    hasReleaseNotes: true,
};

const temporaryDirectories: string[] = [];

afterAll(async () => {
    await Promise.all(temporaryDirectories.map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
    }));
});

function contract(
    overrides: Partial<PackageContractInput> = {},
): PackageContractInput {
    return { ...baseInput, ...overrides };
}

function failuresFor(overrides: Partial<PackageContractInput> = {}): string[] {
    return validatePackageContract(contract(overrides));
}

async function packageDirectory(
    files: Readonly<Record<string, unknown>>,
): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'quoin-contract-'));
    temporaryDirectories.push(dir);
    for (const [name, value] of Object.entries(files)) {
        await writeFile(
            path.join(dir, name),
            `${JSON.stringify(value, null, 2)}\n`,
        );
    }
    return dir;
}

describe('validatePackageContract', () => {
    it('accepts a compliant package', () => {
        expect(failuresFor()).toEqual([]);
    });

    it('requires a package name', () => {
        expect(failuresFor({ name: undefined, lockName: undefined, lockRootName: undefined }))
            .toContain('package.json must declare a name.');
        expect(failuresFor({ name: '   ' })).toContain(
            'package.json must declare a name.',
        );
    });

    it('rejects private packages', () => {
        expect(failuresFor({ isPrivate: true })).toContain(
            'package.json must not mark the package private.',
        );
    });

    it('rejects workspaces', () => {
        const failures = failuresFor({ hasWorkspaces: true });
        expect(failures).toContain(
            'package.json must not declare workspaces; quoin releases one root package.',
        );
    });

    it('requires a releasable semantic version', () => {
        const message =
            'package version must be valid semantic versioning without build metadata.';
        expect(failuresFor({ version: '1.0', tag: 'v1.0' })).toContain(message);
        expect(failuresFor({ version: '01.0.0', tag: 'v01.0.0' })).toContain(message);
        expect(failuresFor({
            version: '1.0.0+build',
            tag: 'v1.0.0+build',
            lockVersion: '1.0.0+build',
            lockRootVersion: '1.0.0+build',
        })).toContain(message);
    });

    it('requires the tag to match the version exactly', () => {
        expect(failuresFor({ tag: 'v0.1.3' })).toContain(
            'release tag must exactly match v<package version>.',
        );
        expect(failuresFor({ tag: '0.1.2' })).toContain(
            'release tag must exactly match v<package version>.',
        );
        expect(failuresFor({ tag: 'v0.1.2' })).toEqual([]);
    });

    it('accepts prerelease versions', () => {
        expect(failuresFor({
            tag: 'v0.2.0-alpha.1',
            version: '0.2.0-alpha.1',
            lockVersion: '0.2.0-alpha.1',
            lockRootVersion: '0.2.0-alpha.1',
        })).toEqual([]);
    });

    it('allows unscoped packages to omit publishConfig.access', () => {
        expect(failuresFor({ publishAccess: undefined })).toEqual([]);
    });

    it('requires scoped packages to declare public access', () => {
        expect(failuresFor({
            name: '@zsumz/fixture',
            lockName: '@zsumz/fixture',
            lockRootName: '@zsumz/fixture',
            publishAccess: undefined,
        })).toContain('scoped packages must set publishConfig.access to public.');
        expect(failuresFor({
            name: '@zsumz/fixture',
            lockName: '@zsumz/fixture',
            lockRootName: '@zsumz/fixture',
            publishAccess: 'public',
        })).toEqual([]);
    });

    it('rejects non-public access', () => {
        expect(failuresFor({ publishAccess: 'restricted' })).toContain(
            'publishConfig.access must be public, found restricted.',
        );
    });

    it('rejects disabled provenance only when explicitly false', () => {
        expect(failuresFor({ publishProvenance: false })).toContain(
            'publishConfig.provenance must not be disabled.',
        );
        expect(failuresFor({ publishProvenance: true })).toEqual([]);
        expect(failuresFor({ publishProvenance: undefined })).toEqual([]);
    });

    it('requires a repository url that identifies the caller repository', () => {
        expect(failuresFor({ repositoryUrl: undefined })).toContain(
            'package.json must declare a repository url.',
        );
        expect(failuresFor({ repositoryUrl: 'https://gitlab.com/zsumz/smoque' }))
            .toContain(
                'repository url https://gitlab.com/zsumz/smoque must identify a github.com repository.',
            );
        expect(failuresFor({ repositoryUrl: 'https://github.com/other/smoque' }))
            .toContain('package.json repository other/smoque must be zsumz/smoque.');
    });

    it('compares repository identity case-insensitively', () => {
        expect(failuresFor({
            repositoryUrl: 'https://github.com/ZsumZ/Smoque.git',
        })).toEqual([]);
    });

    it('requires a lockfile', () => {
        expect(failuresFor({
            hasLockfile: false,
            lockName: undefined,
            lockVersion: undefined,
            lockRootName: undefined,
            lockRootVersion: undefined,
        })).toEqual(['package-lock.json must exist.']);
    });

    it('requires the lockfile to agree on name', () => {
        const message = 'package-lock.json names must match package.json.';
        expect(failuresFor({ lockName: 'other' })).toContain(message);
        expect(failuresFor({ lockRootName: 'other' })).toContain(message);
        expect(failuresFor({ lockRootName: undefined })).toContain(message);
    });

    it('requires the lockfile to agree on version, including the root entry', () => {
        const message = 'package-lock.json versions must match package.json.';
        expect(failuresFor({ lockVersion: '0.1.1' })).toContain(message);
        expect(failuresFor({ lockRootVersion: '0.1.1' })).toContain(message);
        expect(failuresFor({ lockRootVersion: undefined })).toContain(message);
    });

    it('rejects versions already present on the registry', () => {
        expect(failuresFor({ registryHasVersion: true })).toContain(
            'the npm registry already contains smoque@0.1.2.',
        );
    });

    it('requires committed release notes', () => {
        expect(failuresFor({ hasReleaseNotes: false })).toContain(
            'docs/releases/v0.1.2.md must contain release notes.',
        );
    });

    it('reports every failure at once', () => {
        const failures = failuresFor({
            name: undefined,
            version: undefined,
            isPrivate: true,
            hasWorkspaces: true,
            publishAccess: 'restricted',
            publishProvenance: false,
            repositoryUrl: 'https://example.com/zsumz/smoque',
            registryHasVersion: true,
            hasReleaseNotes: false,
        });
        expect(failures.length).toBeGreaterThan(8);
        expect(failures).toContain('committed release notes must exist.');
        expect(failures).toContain('the npm registry already contains this version.');
    });
});

describe('normalizeRepositoryUrl', () => {
    it('canonicalizes every supported github form', () => {
        const forms = [
            'https://github.com/zsumz/smoque',
            'https://github.com/zsumz/smoque/',
            'https://github.com/zsumz/smoque.git',
            'https://github.com/zsumz/smoque.git/',
            'https://www.github.com/zsumz/smoque',
            'http://github.com/zsumz/smoque',
            'git+https://github.com/zsumz/smoque.git',
            'git://github.com/zsumz/smoque.git',
            'ssh://git@github.com/zsumz/smoque.git',
            'git+ssh://git@github.com/zsumz/smoque.git',
            'git@github.com:zsumz/smoque.git',
            'git+ssh://git@github.com/zsumz/smoque',
            'github:zsumz/smoque',
            'zsumz/smoque',
            '  https://github.com/zsumz/smoque#readme  ',
            'https://github.com/zsumz/smoque?tab=readme',
        ];
        for (const form of forms) {
            expect(normalizeRepositoryUrl(form)).toBe('zsumz/smoque');
        }
    });

    it('preserves owner and name casing', () => {
        expect(normalizeRepositoryUrl('https://github.com/ZsumZ/Smoque')).toBe(
            'ZsumZ/Smoque',
        );
    });

    it('returns null for anything that is not a github repository', () => {
        const rejected = [
            '',
            '   ',
            'https://gitlab.com/zsumz/smoque',
            'https://example.com/github.com/zsumz/smoque',
            'gitlab:zsumz/smoque',
            'https://github.com/zsumz',
            'https://github.com/zsumz/smoque/tree/main',
            'https://github.com//smoque',
            'https://github.com/zsumz/..',
            'not a url',
            'zsumz/smo que',
        ];
        for (const value of rejected) {
            expect(normalizeRepositoryUrl(value)).toBeNull();
        }
    });
});

describe('readPackageMetadata', () => {
    it('reads manifest and lockfile facts from disk', async () => {
        const dir = await packageDirectory({
            'package.json': {
                name: 'smoque',
                version: '0.1.2',
                repository: {
                    type: 'git',
                    url: 'git+https://github.com/zsumz/smoque.git',
                },
                publishConfig: { access: 'public', provenance: true },
            },
            'package-lock.json': {
                name: 'smoque',
                version: '0.1.2',
                lockfileVersion: 3,
                packages: { '': { name: 'smoque', version: '0.1.2' } },
            },
        });
        expect(await readPackageMetadata(dir)).toEqual({
            name: 'smoque',
            version: '0.1.2',
            isPrivate: false,
            hasWorkspaces: false,
            publishAccess: 'public',
            publishProvenance: true,
            repositoryUrl: 'git+https://github.com/zsumz/smoque.git',
            hasLockfile: true,
            lockName: 'smoque',
            lockVersion: '0.1.2',
            lockRootName: 'smoque',
            lockRootVersion: '0.1.2',
        });
    });

    it('detects private, workspaces, shorthand repository, and a missing lockfile', async () => {
        const dir = await packageDirectory({
            'package.json': {
                name: 'smoque',
                version: '0.1.2',
                private: true,
                workspaces: ['packages/*'],
                repository: 'github:zsumz/smoque',
                publishConfig: { provenance: false },
            },
        });
        const metadata = await readPackageMetadata(dir);
        expect(metadata.isPrivate).toBe(true);
        expect(metadata.hasWorkspaces).toBe(true);
        expect(metadata.repositoryUrl).toBe('github:zsumz/smoque');
        expect(metadata.publishProvenance).toBe(false);
        expect(metadata.hasLockfile).toBe(false);
        expect(metadata.publishAccess).toBeUndefined();
    });

    it('reads string-encoded publishConfig flags and ignores junk values', async () => {
        const disabled = await packageDirectory({
            'package.json': {
                name: 'smoque',
                publishConfig: { provenance: 'false', access: 'public' },
            },
        });
        expect((await readPackageMetadata(disabled)).publishProvenance).toBe(false);
        const enabled = await packageDirectory({
            'package.json': {
                name: 'smoque',
                publishConfig: { provenance: 'true' },
            },
        });
        expect((await readPackageMetadata(enabled)).publishProvenance).toBe(true);
        const junk = await packageDirectory({
            'package.json': { name: 'smoque', publishConfig: { provenance: 1 } },
        });
        expect((await readPackageMetadata(junk)).publishProvenance).toBeUndefined();
    });

    it('throws when package.json is missing', async () => {
        const dir = await packageDirectory({});
        await expect(readPackageMetadata(dir)).rejects.toThrow(
            /Package metadata failed/u,
        );
    });

    it('feeds the pure contract validator', async () => {
        const dir = await packageDirectory({
            'package.json': {
                name: 'smoque',
                version: '0.1.2',
                repository: 'https://github.com/zsumz/smoque',
            },
            'package-lock.json': {
                name: 'smoque',
                version: '0.1.2',
                packages: { '': { name: 'smoque', version: '0.1.2' } },
            },
        });
        const metadata = await readPackageMetadata(dir);
        expect(validatePackageContract({
            ...metadata,
            tag: 'v0.1.2',
            expectedRepository: 'zsumz/smoque',
            registryHasVersion: false,
            hasReleaseNotes: true,
        })).toEqual([]);
    });
});
