import path from 'node:path';

import { readReleaseMetadata } from '../../contract/package.ts';
import { formatCheckReport, runCheck, SIGNING_KEY_FILE } from '../check.ts';
import { ensureDirectory } from '../support.ts';
import {
    CALLER_WORKFLOW_FILE,
    WORKFLOWS_DIRECTORY,
    type Profile,
} from '../template.ts';
import { STRICT_DIRECTORIES, type InitOptions } from './model.ts';
import {
    declaredRepositoryMismatch,
    detectRepository,
    npmTrustCommand,
    scriptWarnings,
    setupChecklist,
} from './setup.ts';
import {
    generateCallerWorkflow,
    resolveWorkflowSha,
    upgradeCallerWorkflow,
} from './workflow.ts';

export async function runInit(options: InitOptions): Promise<number> {
    const dir = path.resolve(options.dir);
    const { log } = options;
    const release = await readReleaseMetadata(dir);
    const { root } = release;
    const name = root.name;
    const version = root.version;
    if (name === undefined || name.trim() === '') {
        throw new Error('Installation failed: package.json must declare a name.');
    }
    if (version === undefined || version.trim() === '') {
        throw new Error('Installation failed: package.json must declare a version.');
    }
    if (!release.isFamily && root.isPrivate) {
        throw new Error('Installation failed: sallyport releases public packages only.');
    }
    if (!release.isFamily && root.hasWorkspaces) {
        throw new Error('Installation failed: workspaces require sallyport.packages.');
    }
    if (release.isFamily && (!root.isPrivate || !root.hasWorkspaces)) {
        throw new Error(
            'Installation failed: a package family root must be private and use workspaces.',
        );
    }
    if (!root.hasLockfile) {
        throw new Error('Installation failed: package-lock.json must exist next to package.json.');
    }
    const packageNames = release.packages.map((member) => member.name?.trim() ?? '');
    const familyFailures = [...release.configurationFailures];
    for (const member of release.packages) {
        const label = member.directory === '' ? 'package.json' : member.directory + '/package.json';
        if (member.name === undefined || member.name.trim() === '') {
            familyFailures.push(label + ' must declare a name.');
        }
        if (member.isPrivate) familyFailures.push(label + ' must be public.');
        if (member.version !== version) familyFailures.push(label + ' version must match the root.');
        if (member.name?.startsWith('@') === true && member.publishAccess !== 'public') {
            familyFailures.push(label + ' scoped package must set public access.');
        }
        if (member.lockName !== member.name || member.lockVersion !== member.version) {
            familyFailures.push('package-lock.json must match ' + member.directory + '.');
        }
        if (release.isFamily && member.repositoryDirectory !== member.directory) {
            familyFailures.push(label + ' repository.directory must match its roster path.');
        }
    }
    if (familyFailures.length > 0) {
        throw new Error('Installation failed: ' + familyFailures.join(' '));
    }

    const repository = detectRepository(dir, options.exec);
    const profile: Profile = options.strict ? 'strict' : 'standard';
    const sha = resolveWorkflowSha(options.sha);
    const workflowFile = path.join(dir, CALLER_WORKFLOW_FILE);

    const releaseLabel = release.isFamily
        ? `${name}@${version} (${String(packageNames.length)} packages)` : `${name}@${version}`;
    log(`sallyport init ${releaseLabel}`);
    log(`  repository  ${repository}`);
    log(`  profile     ${profile}`);
    log(`  sallyport sha ${sha}`);
    log('');

    await ensureDirectory(path.join(dir, WORKFLOWS_DIRECTORY));
    if (options.upgrade) {
        await upgradeCallerWorkflow(workflowFile, sha, options.force);
        log(`Updated ${CALLER_WORKFLOW_FILE}; both reusable workflows now pin ${sha}.`);
    } else {
        await generateCallerWorkflow(workflowFile, sha, profile);
        log(`Generated ${CALLER_WORKFLOW_FILE}.`);
    }

    if (options.strict) {
        for (const directory of STRICT_DIRECTORIES) {
            await ensureDirectory(path.join(dir, directory));
            log(`Ensured ${directory}/ exists.`);
        }
        log(`Commit the public release signing key to ${SIGNING_KEY_FILE}.`);
    }

    for (const warning of await scriptWarnings(dir)) {
        log(`Warning: ${warning}`);
    }
    if (declaredRepositoryMismatch(root.repositoryUrl, repository)) {
        log(`Warning: package.json repository does not resolve to ${repository}.`);
    }

    log('');
    log('Configure npm trusted publishers:');
    log('');
    for (const packageName of packageNames) {
        for (const line of npmTrustCommand(packageName, repository)) {
            log(`  ${line}`);
        }
        log('');
    }
    for (const line of setupChecklist(profile, version)) {
        log(line);
    }
    log('');

    const report = await runCheck({ dir, exec: options.exec });
    log(formatCheckReport(report).trimEnd());
    return report.ok ? 0 : 1;
}
