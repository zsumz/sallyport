import { releaseNotesPath } from '../release.ts';
import { parseSemver, releaseTagForVersion } from '../semver.ts';
import type {
    ReleaseContractInput,
    ReleasePackageMetadata,
} from './model.ts';
import { normalizeRepositoryUrl } from './repository.ts';

export function validateReleaseContract(input: ReleaseContractInput): string[] {
    const { metadata } = input;
    const failures = [...metadata.configurationFailures];
    failures.push(...rootFailures(input));
    const names: Set<string> = new Set();
    for (const member of metadata.packages) {
        failures.push(...memberFailures(input, member));
        const name = member.name?.trim();
        if (name !== undefined && name !== '') {
            if (names.has(name)) failures.push('package name ' + name + ' is listed more than once.');
            names.add(name);
        }
    }
    if (metadata.packages.length === 0) {
        failures.push('sallyport must release at least one package.');
    }
    return failures;
}

function rootFailures(input: ReleaseContractInput): string[] {
    const { root, isFamily } = input.metadata;
    const failures: string[] = [];
    if (isFamily && !root.isPrivate) failures.push('a package family root must be private.');
    if (isFamily && !root.hasWorkspaces) failures.push('a package family root must declare workspaces.');
    if (!isFamily && root.isPrivate) failures.push('package.json must not mark the package private.');
    if (!isFamily && root.hasWorkspaces) {
        failures.push('package.json workspaces require an explicit sallyport.packages roster.');
    }
    if (root.version === undefined || parseSemver(root.version) === null) {
        failures.push('release version must be valid semantic versioning without build metadata.');
    } else if (input.tag !== releaseTagForVersion(root.version)) {
        failures.push('release tag must exactly match v<release version>.');
    }
    if (!root.hasLockfile) failures.push('package-lock.json must exist.');
    if (root.lockName !== root.name || root.lockRootName !== root.name) {
        failures.push('package-lock.json root names must match package.json.');
    }
    if (root.lockVersion !== root.version || root.lockRootVersion !== root.version) {
        failures.push('package-lock.json root versions must match package.json.');
    }
    if (!input.hasReleaseNotes) {
        failures.push(root.version === undefined
            ? 'committed release notes must exist.'
            : releaseNotesPath(root.version) + ' must contain release notes.');
    }
    return failures;
}

function memberFailures(
    input: ReleaseContractInput,
    member: ReleasePackageMetadata,
): string[] {
    const label = member.directory === '' ? 'package.json' : member.directory + '/package.json';
    const failures: string[] = [];
    if (member.name === undefined || member.name.trim() === '') {
        failures.push(label + ' must declare a name.');
    }
    if (member.isPrivate) failures.push(label + ' must not mark the package private.');
    if (member.hasWorkspaces) failures.push(label + ' must not declare workspaces.');
    if (member.version !== input.metadata.root.version) {
        failures.push(
            label + ' version must match the release version '
            + (input.metadata.root.version ?? 'declared at the root') + '.',
        );
    }
    failures.push(...publishFailures(member, label));
    failures.push(...repositoryFailures(input, member, label));
    if (!member.hasLockfile || member.lockName !== member.name
        || member.lockVersion !== member.version) {
        failures.push(
            'package-lock.json must contain '
            + (member.directory === '' ? 'the root package' : member.directory)
            + ' with matching name and version.',
        );
    }
    if (member.name !== undefined && member.version !== undefined
        && input.registryVersions.has(member.name + '@' + member.version)) {
        failures.push('the npm registry already contains '
            + member.name + '@' + member.version + '.');
    }
    return failures;
}

function publishFailures(member: ReleasePackageMetadata, label: string): string[] {
    const failures: string[] = [];
    if (member.publishAccess !== 'public' && member.name?.startsWith('@') === true) {
        failures.push(label + ' scoped package must set publishConfig.access to public.');
    } else if (member.publishAccess !== undefined && member.publishAccess !== 'public') {
        failures.push(label + ' publishConfig.access must be public, found '
            + member.publishAccess + '.');
    }
    if (member.publishProvenance === false) {
        failures.push(label + ' publishConfig.provenance must not be disabled.');
    }
    return failures;
}

function repositoryFailures(
    input: ReleaseContractInput,
    member: ReleasePackageMetadata,
    label: string,
): string[] {
    const repository = normalizeRepositoryUrl(member.repositoryUrl ?? '');
    const expected = normalizeRepositoryUrl(input.expectedRepository) ?? input.expectedRepository;
    if (repository === null) return [label + ' must declare a github.com repository url.'];
    if (repository.toLowerCase() !== expected.toLowerCase()) {
        return [label + ' repository ' + repository + ' must be ' + expected + '.'];
    }
    if (input.metadata.isFamily && member.repositoryDirectory !== member.directory) {
        return [label + ' repository.directory must be ' + member.directory + '.'];
    }
    return [];
}
