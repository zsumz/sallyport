import path from 'node:path';

import { readPackageMetadata } from '../../contract/package.ts';
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
    const metadata = await readPackageMetadata(dir);
    const name = metadata.name;
    const version = metadata.version;
    if (name === undefined || name.trim() === '') {
        throw new Error('Installation failed: package.json must declare a name.');
    }
    if (version === undefined || version.trim() === '') {
        throw new Error('Installation failed: package.json must declare a version.');
    }
    if (metadata.isPrivate) {
        throw new Error('Installation failed: quoin releases public packages only.');
    }
    if (metadata.hasWorkspaces) {
        throw new Error('Installation failed: quoin releases one root package per repository.');
    }
    if (!metadata.hasLockfile) {
        throw new Error('Installation failed: package-lock.json must exist next to package.json.');
    }

    const repository = detectRepository(dir, options.exec);
    const profile: Profile = options.strict ? 'strict' : 'standard';
    const sha = resolveWorkflowSha(options.sha);
    const workflowFile = path.join(dir, CALLER_WORKFLOW_FILE);

    log(`quoin init ${name}@${version}`);
    log(`  repository  ${repository}`);
    log(`  profile     ${profile}`);
    log(`  quoin sha ${sha}`);
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
    if (declaredRepositoryMismatch(metadata.repositoryUrl, repository)) {
        log(`Warning: package.json repository does not resolve to ${repository}.`);
    }

    log('');
    log('Configure the npm trusted publisher:');
    log('');
    for (const line of npmTrustCommand(name, repository)) {
        log(`  ${line}`);
    }
    log('');
    for (const line of setupChecklist(profile, version)) {
        log(line);
    }
    log('');

    const report = await runCheck({ dir, exec: options.exec });
    log(formatCheckReport(report).trimEnd());
    return report.ok ? 0 : 1;
}
