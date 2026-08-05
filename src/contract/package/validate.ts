import { releaseNotesPath } from '../release.ts';
import { parseSemver, releaseTagForVersion } from '../semver.ts';
import type { PackageContractInput } from './model.ts';
import { normalizeRepositoryUrl } from './repository.ts';

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
        failures.push(`the npm registry already contains ${describeRelease(name, version)}.`);
    }
    if (!input.hasReleaseNotes) {
        failures.push(version === undefined
            ? 'committed release notes must exist.'
            : `${releaseNotesPath(version)} must contain release notes.`);
    }
    return failures;
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
        return [`repository url ${repositoryUrl} must identify a github.com repository.`];
    }
    const expected = normalizeRepositoryUrl(input.expectedRepository)
        ?? input.expectedRepository;
    return repository.toLowerCase() === expected.toLowerCase()
        ? []
        : [`package.json repository ${repository} must be ${expected}.`];
}

function lockfileFailures(input: PackageContractInput): string[] {
    if (!input.hasLockfile) {
        return ['package-lock.json must exist.'];
    }
    const failures: string[] = [];
    if (input.lockName !== input.name || input.lockRootName !== input.name) {
        failures.push('package-lock.json names must match package.json.');
    }
    if (input.lockVersion !== input.version || input.lockRootVersion !== input.version) {
        failures.push('package-lock.json versions must match package.json.');
    }
    return failures;
}

function describeRelease(
    name: string | undefined,
    version: string | undefined,
): string {
    return name === undefined || version === undefined
        ? 'this version'
        : `${name}@${version}`;
}
