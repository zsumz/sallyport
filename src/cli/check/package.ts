import { normalizeRepositoryUrl } from '../../contract/package.ts';
import { result, type CheckContext, type CheckResult } from './model.ts';

export function packagePublicCheck(context: CheckContext): CheckResult {
    const id = 'package-public';
    const { metadata } = context;
    if (metadata === null) {
        return result(id, 'fail', context.metadataError);
    }
    const failures: string[] = [];
    if (metadata.name === undefined || metadata.name.trim() === '') {
        failures.push('package.json must declare a name.');
    }
    if (metadata.isPrivate) {
        failures.push('package.json must not mark the package private.');
    }
    if (metadata.hasWorkspaces) {
        failures.push('package.json must not declare workspaces; quoin releases one root package.');
    }
    if (metadata.publishAccess !== undefined && metadata.publishAccess !== 'public') {
        failures.push(`publishConfig.access must be public, found ${metadata.publishAccess}.`);
    } else if (metadata.publishAccess === undefined && metadata.name?.startsWith('@') === true) {
        failures.push('scoped packages must set publishConfig.access to public.');
    }
    if (metadata.publishProvenance === false) {
        failures.push('publishConfig.provenance must not be disabled.');
    }
    return failures.length > 0
        ? result(id, 'fail', failures.join(' '))
        : result(id, 'pass', `${metadata.name ?? 'the package'} is published publicly.`);
}

export function lockfileCheck(context: CheckContext): CheckResult {
    const id = 'lockfile-matches';
    const { metadata } = context;
    if (metadata === null) {
        return result(id, 'fail', context.metadataError);
    }
    if (!metadata.hasLockfile) {
        return result(id, 'fail', 'package-lock.json must exist.');
    }
    const failures: string[] = [];
    if (metadata.lockName !== metadata.name || metadata.lockRootName !== metadata.name) {
        failures.push('package-lock.json names must match package.json.');
    }
    if (metadata.lockVersion !== metadata.version || metadata.lockRootVersion !== metadata.version) {
        failures.push('package-lock.json versions must match package.json.');
    }
    return failures.length > 0
        ? result(id, 'fail', failures.join(' '))
        : result(id, 'pass', 'package-lock.json agrees with package.json.');
}

export function repositoryCheck(context: CheckContext): CheckResult {
    const id = 'repository-remote';
    const { metadata, remote } = context;
    if (metadata === null) {
        return result(id, 'fail', context.metadataError);
    }
    if (remote === null) {
        return result(id, 'fail', `the git remote origin could not be read: ${context.remoteError}`);
    }
    const declared = metadata.repositoryUrl;
    if (declared === undefined || declared.trim() === '') {
        return result(id, 'fail', 'package.json must declare a repository url.');
    }
    const declaredRepository = normalizeRepositoryUrl(declared);
    if (declaredRepository === null) {
        return result(id, 'fail', `repository url ${declared} must identify a github.com repository.`);
    }
    const remoteRepository = remoteRepositoryName(remote);
    if (remoteRepository === null) {
        return result(id, 'fail', `git remote origin ${remote} must identify a github.com repository.`);
    }
    if (declaredRepository.toLowerCase() !== remoteRepository.toLowerCase()) {
        return result(
            id,
            'fail',
            `package.json repository ${declaredRepository} must be ${remoteRepository}.`,
        );
    }
    return result(id, 'pass', `package.json and git agree on ${remoteRepository}.`);
}

export function scriptCheck(context: CheckContext, id: string, script: string): CheckResult {
    const value = context.scripts[script];
    return value === undefined || value.trim() === ''
        ? result(id, 'fail', `package.json must define the ${script} script.`)
        : result(id, 'pass', `${script} is defined.`);
}

// The declared repository url must be a real github.com reference, but the
// local remote may go through an SSH host alias (git@github-work:owner/name).
function remoteRepositoryName(remote: string): string | null {
    const direct = normalizeRepositoryUrl(remote);
    if (direct !== null) {
        return direct;
    }
    const alias = /^[\w.-]+@[\w.-]+:([^:/]+\/[^:/]+?)(?:\.git)?\/?$/.exec(remote.trim());
    const coordinates = alias?.[1];
    return coordinates === undefined ? null : normalizeRepositoryUrl(coordinates);
}
