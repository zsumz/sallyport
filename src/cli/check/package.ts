import {
    normalizeRepositoryRemote,
    normalizeRepositoryUrl,
} from '../../contract/package.ts';
import { result, type CheckContext, type CheckResult } from './model.ts';

export function packagePublicCheck(context: CheckContext): CheckResult {
    const id = 'package-public';
    const release = context.releaseMetadata;
    if (release === null) return result(id, 'fail', context.metadataError);
    const failures = [...release.configurationFailures];
    if (release.isFamily) {
        if (!release.root.isPrivate) failures.push('a package family root must be private.');
        if (!release.root.hasWorkspaces) failures.push('a package family root must declare workspaces.');
    } else {
        if (release.root.isPrivate) failures.push('package.json must not mark the package private.');
        if (release.root.hasWorkspaces) {
            failures.push('package.json workspaces require sallyport.packages.');
        }
    }
    for (const member of release.packages) {
        const label = member.directory === '' ? 'package.json' : member.directory + '/package.json';
        if (member.name === undefined || member.name.trim() === '') {
            failures.push(label + ' must declare a name.');
        }
        if (member.isPrivate) failures.push(label + ' must not mark the package private.');
        if (member.publishAccess !== undefined && member.publishAccess !== 'public') {
            failures.push(label + ' publishConfig.access must be public.');
        } else if (member.publishAccess === undefined && member.name?.startsWith('@') === true) {
            failures.push(label + ' scoped package must set publishConfig.access to public.');
        }
        if (member.publishProvenance === false) {
            failures.push(label + ' publishConfig.provenance must not be disabled.');
        }
    }
    if (failures.length > 0) return result(id, 'fail', failures.join(' '));
    const description = release.isFamily
        ? String(release.packages.length) + ' packages are configured for public release.'
        : (release.root.name ?? 'the package') + ' is published publicly.';
    return result(id, 'pass', description);
}

export function lockfileCheck(context: CheckContext): CheckResult {
    const id = 'lockfile-matches';
    const release = context.releaseMetadata;
    if (release === null) return result(id, 'fail', context.metadataError);
    const { root } = release;
    if (!root.hasLockfile) return result(id, 'fail', 'package-lock.json must exist.');
    const failures: string[] = [];
    if (root.lockName !== root.name || root.lockRootName !== root.name) {
        failures.push('package-lock.json root names must match package.json.');
    }
    if (root.lockVersion !== root.version || root.lockRootVersion !== root.version) {
        failures.push('package-lock.json root versions must match package.json.');
    }
    for (const member of release.packages) {
        if (member.lockName !== member.name || member.lockVersion !== member.version) {
            failures.push(
                'package-lock.json entry for '
                + (member.directory === '' ? 'the root' : member.directory)
                + ' must match its package.json.',
            );
        }
    }
    return failures.length > 0
        ? result(id, 'fail', failures.join(' '))
        : result(id, 'pass', 'package-lock.json agrees with every release package.');
}

export function repositoryCheck(context: CheckContext): CheckResult {
    const id = 'repository-remote';
    const { releaseMetadata, remote } = context;
    if (releaseMetadata === null) {
        return result(id, 'fail', context.metadataError);
    }
    if (remote === null) {
        return result(id, 'fail', `the git remote origin could not be read: ${context.remoteError}`);
    }
    const declared = releaseMetadata.root.repositoryUrl;
    if (declared === undefined || declared.trim() === '') {
        return result(id, 'fail', 'package.json must declare a repository url.');
    }
    const declaredRepository = normalizeRepositoryUrl(declared);
    if (declaredRepository === null) {
        return result(id, 'fail', `repository url ${declared} must identify a github.com repository.`);
    }
    const remoteRepository = normalizeRepositoryRemote(remote);
    if (remoteRepository === null) {
        return result(id, 'fail', `git remote origin ${remote} must identify a github.com repository.`);
    }
    const failures: string[] = [];
    if (declaredRepository.toLowerCase() !== remoteRepository.toLowerCase()) {
        failures.push(`package.json repository ${declaredRepository} must be ${remoteRepository}.`);
    }
    for (const member of releaseMetadata.packages) {
        const memberRepository = normalizeRepositoryUrl(member.repositoryUrl ?? '');
        const label = member.directory === ''
            ? 'package.json'
            : `${member.directory}/package.json`;
        if (memberRepository?.toLowerCase() !== remoteRepository.toLowerCase()) {
            failures.push(`${label} repository must be ${remoteRepository}.`);
        }
        if (releaseMetadata.isFamily && member.repositoryDirectory !== member.directory) {
            failures.push(`${label} repository.directory must be ${member.directory}.`);
        }
    }
    if (failures.length > 0) return result(id, 'fail', failures.join(' '));
    return result(id, 'pass', `package.json and git agree on ${remoteRepository}.`);
}

export function scriptCheck(context: CheckContext, id: string, script: string): CheckResult {
    const value = context.scripts[script];
    return value === undefined || value.trim() === ''
        ? result(id, 'fail', `package.json must define the ${script} script.`)
        : result(id, 'pass', `${script} is defined.`);
}
