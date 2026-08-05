import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { readPackageMetadata } from '../../contract/package.ts';
import { RELEASE_NOTES_DIRECTORY } from '../../contract/release.ts';
import type { CommandRunner } from '../../contract/signing.ts';
import {
    CALLER_WORKFLOW_FILE,
    detectProfile,
    WORKFLOWS_DIRECTORY,
} from '../template.ts';
import {
    errorMessage,
    isDirectory,
    isFile,
    readJsonFile,
    readStringMap,
    readTextFile,
} from '../support.ts';
import {
    SIGNING_KEY_FILE,
    type CheckContext,
    type CheckOptions,
    type WorkflowFile,
} from './model.ts';

const WORKFLOW_EXTENSION_PATTERN = /\.ya?ml$/u;

export async function loadContext(options: CheckOptions): Promise<CheckContext> {
    const dir = path.resolve(options.dir);
    const manifest = await readJsonFile(path.join(dir, 'package.json'));
    let metadata: CheckContext['metadata'] = null;
    let metadataError = '';
    try {
        metadata = await readPackageMetadata(dir);
    } catch (error) {
        metadataError = errorMessage(error);
    }
    const remote = readGitRemote(dir, options.exec);
    const workflow = await readTextFile(path.join(dir, CALLER_WORKFLOW_FILE));
    return {
        metadata,
        metadataError,
        scripts: readStringMap(manifest, 'scripts'),
        remote: remote.url,
        remoteError: remote.error,
        workflow,
        profile: workflow === null ? 'standard' : detectProfile(workflow),
        workflows: await readWorkflowFiles(dir),
        hasReleaseNotesDirectory: await isDirectory(path.join(dir, RELEASE_NOTES_DIRECTORY)),
        hasSigningKey: await isFile(path.join(dir, SIGNING_KEY_FILE)),
    };
}

function readGitRemote(
    dir: string,
    exec: CommandRunner,
): { url: string | null; error: string } {
    try {
        const result = exec('git', ['remote', 'get-url', 'origin'], { cwd: dir });
        const url = result.stdout.trim();
        if (url === '') {
            return { url: null, error: 'git remote get-url origin returned nothing.' };
        }
        return { url, error: '' };
    } catch (error) {
        return { url: null, error: errorMessage(error).split('\n')[0] ?? 'git failed.' };
    }
}

async function readWorkflowFiles(dir: string): Promise<WorkflowFile[]> {
    const workflowsDir = path.join(dir, WORKFLOWS_DIRECTORY);
    let entries: string[];
    try {
        entries = await readdir(workflowsDir);
    } catch {
        return [];
    }
    const files: WorkflowFile[] = [];
    for (const name of entries.sort()) {
        if (!WORKFLOW_EXTENSION_PATTERN.test(name)) {
            continue;
        }
        const content = await readTextFile(path.join(workflowsDir, name));
        if (content !== null) {
            files.push({ name, content });
        }
    }
    return files;
}
