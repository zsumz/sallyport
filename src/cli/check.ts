import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
    normalizeRepositoryUrl,
    readPackageMetadata,
    type PackageMetadata,
} from '../contract/package.ts';
import { RELEASE_NOTES_DIRECTORY } from '../contract/release.ts';
import type { CommandRunner } from '../contract/signing.ts';
import {
    CALLER_WORKFLOW_FILE,
    CALLER_WORKFLOW_FILENAME,
    detectProfile,
    FINALIZE_WORKFLOW,
    hasGeneratedMarker,
    STAGE_WORKFLOW,
    WORKFLOWS_DIRECTORY,
    workflowRef,
    type Profile,
} from './template.ts';
import {
    errorMessage,
    isDirectory,
    isFile,
    readJsonFile,
    readStringMap,
    readTextFile,
} from './support.ts';

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface CheckResult {
    id: string;
    status: CheckStatus;
    message: string;
}

export interface CheckReport {
    checks: CheckResult[];
    ok: boolean;
}

export interface CheckOptions {
    dir: string;
    exec: CommandRunner;
}

export const SIGNING_KEY_FILE = 'etc/release-signing-key.asc';

const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const WORKFLOW_EXTENSION_PATTERN = /\.ya?ml$/u;
const TOKEN_PATTERNS = [
    /NODE_AUTH_TOKEN/iu,
    /NPM_TOKEN/iu,
    /npm_config__auth/iu,
    /_authToken/iu,
] as const;
const DIRECT_PUBLISH_COMMAND = 'npm publish';

const CHECK_LABELS: ReadonlyArray<readonly [string, string]> = [
    ['package-public', 'package is public'],
    ['lockfile-matches', 'package-lock matches package.json'],
    ['repository-remote', 'repository URL matches Git remote'],
    ['release-check-script', 'release:check exists'],
    ['release-smoke-script', 'release:smoke exists'],
    ['release-notes-directory', 'release notes directory exists'],
    ['signing-key', 'public signing key exists'],
    ['caller-workflow', 'caller workflow is generated correctly'],
    ['workflow-sha-match', 'stage and finalize use the same SHA'],
    ['workflow-sha-length', 'reusable workflows use full 40-character SHAs'],
    ['no-npm-token', 'no npm publishing token appears in workflows'],
    ['no-direct-publish', 'no direct npm publish workflow exists'],
];

interface WorkflowFile {
    name: string;
    content: string;
}

interface CheckContext {
    metadata: PackageMetadata | null;
    metadataError: string;
    scripts: Record<string, string>;
    remote: string | null;
    remoteError: string;
    workflow: string | null;
    profile: Profile;
    workflows: WorkflowFile[];
    hasReleaseNotesDirectory: boolean;
    hasSigningKey: boolean;
}

export function checkLabel(id: string): string {
    return CHECK_LABELS.find((entry) => entry[0] === id)?.[1] ?? id;
}

export async function runCheck(options: CheckOptions): Promise<CheckReport> {
    const context = await loadContext(options);
    const checks = [
        packagePublicCheck(context),
        lockfileCheck(context),
        repositoryCheck(context),
        scriptCheck(context, 'release-check-script', 'release:check'),
        scriptCheck(context, 'release-smoke-script', 'release:smoke'),
        releaseNotesCheck(context),
        signingKeyCheck(context),
        callerWorkflowCheck(context),
        shaAgreementCheck(context),
        shaLengthCheck(context),
        npmTokenCheck(context),
        directPublishCheck(context),
    ];
    return { checks, ok: checks.every((check) => check.status !== 'fail') };
}

export function formatCheckReport(report: CheckReport): string {
    const lines: string[] = [];
    for (const check of report.checks) {
        const label = checkLabel(check.id);
        lines.push(`${check.status.toUpperCase()} ${label}`);
        if (check.status !== 'pass') {
            lines.push(`     ${check.message}`);
        }
    }
    return `${lines.join('\n')}\n`;
}

async function loadContext(options: CheckOptions): Promise<CheckContext> {
    const dir = path.resolve(options.dir);
    const manifest = await readJsonFile(path.join(dir, 'package.json'));
    let metadata: PackageMetadata | null = null;
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

function result(id: string, status: CheckStatus, message: string): CheckResult {
    return { id, status, message };
}

function packagePublicCheck(context: CheckContext): CheckResult {
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
    if (failures.length > 0) {
        return result(id, 'fail', failures.join(' '));
    }
    return result(id, 'pass', `${metadata.name ?? 'the package'} is published publicly.`);
}

function lockfileCheck(context: CheckContext): CheckResult {
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
    if (failures.length > 0) {
        return result(id, 'fail', failures.join(' '));
    }
    return result(id, 'pass', 'package-lock.json agrees with package.json.');
}

function repositoryCheck(context: CheckContext): CheckResult {
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

// The declared repository url must be a real github.com reference, but the
// local remote may go through an SSH host alias (git@github-work:owner/name);
// only the owner/name coordinates are comparable there.
function remoteRepositoryName(remote: string): string | null {
    const direct = normalizeRepositoryUrl(remote);
    if (direct !== null) {
        return direct;
    }
    const alias = /^[\w.-]+@[\w.-]+:([^:/]+\/[^:/]+?)(?:\.git)?\/?$/.exec(remote.trim());
    const coordinates = alias?.[1];
    if (coordinates === undefined) {
        return null;
    }
    return normalizeRepositoryUrl(coordinates);
}

function scriptCheck(context: CheckContext, id: string, script: string): CheckResult {
    const value = context.scripts[script];
    if (value === undefined || value.trim() === '') {
        return result(id, 'fail', `package.json must define the ${script} script.`);
    }
    return result(id, 'pass', `${script} is defined.`);
}

// Both artifacts are mandatory only under the strict profile; a standard
// consumer sees them as information, never as a failure.
function releaseNotesCheck(context: CheckContext): CheckResult {
    const id = 'release-notes-directory';
    if (context.hasReleaseNotesDirectory) {
        return result(id, 'pass', `${RELEASE_NOTES_DIRECTORY}/ exists.`);
    }
    const message = `${RELEASE_NOTES_DIRECTORY}/ must exist and contain v<version>.md for the release being tagged.`;
    return result(id, context.profile === 'strict' ? 'fail' : 'skip', message);
}

function signingKeyCheck(context: CheckContext): CheckResult {
    const id = 'signing-key';
    if (context.hasSigningKey) {
        return result(id, 'pass', `${SIGNING_KEY_FILE} exists.`);
    }
    const message = `${SIGNING_KEY_FILE} must contain the public release signing key.`;
    return result(id, context.profile === 'strict' ? 'fail' : 'skip', message);
}

function callerWorkflowCheck(context: CheckContext): CheckResult {
    const id = 'caller-workflow';
    const { workflow } = context;
    if (workflow === null) {
        return result(
            id,
            'fail',
            `${CALLER_WORKFLOW_FILE} is missing; generate it with npx quoin init.`,
        );
    }
    if (!hasGeneratedMarker(workflow)) {
        return result(
            id,
            'fail',
            `${CALLER_WORKFLOW_FILE} was hand-edited; its first line must be the quoin generated-by marker.`,
        );
    }
    const missing = [
        workflowRef(workflow, STAGE_WORKFLOW) === null ? STAGE_WORKFLOW : null,
        workflowRef(workflow, FINALIZE_WORKFLOW) === null ? FINALIZE_WORKFLOW : null,
    ].filter((value): value is string => value !== null);
    if (missing.length > 0) {
        return result(
            id,
            'fail',
            `${CALLER_WORKFLOW_FILE} must call ${missing.join(' and ')}.`,
        );
    }
    return result(id, 'pass', `${CALLER_WORKFLOW_FILE} is generated and unmodified.`);
}

function shaAgreementCheck(context: CheckContext): CheckResult {
    const id = 'workflow-sha-match';
    const { workflow } = context;
    if (workflow === null) {
        return result(id, 'fail', `${CALLER_WORKFLOW_FILE} is missing.`);
    }
    const stage = workflowRef(workflow, STAGE_WORKFLOW);
    const finalize = workflowRef(workflow, FINALIZE_WORKFLOW);
    if (stage === null || finalize === null) {
        return result(
            id,
            'fail',
            `${CALLER_WORKFLOW_FILE} must pin both stage.yml and finalize.yml.`,
        );
    }
    if (stage !== finalize) {
        return result(
            id,
            'fail',
            `stage.yml is pinned to ${stage} but finalize.yml is pinned to ${finalize}.`,
        );
    }
    return result(id, 'pass', `both reusable workflows are pinned to ${stage}.`);
}

function shaLengthCheck(context: CheckContext): CheckResult {
    const id = 'workflow-sha-length';
    const { workflow } = context;
    if (workflow === null) {
        return result(id, 'fail', `${CALLER_WORKFLOW_FILE} is missing.`);
    }
    const refs = [
        [STAGE_WORKFLOW, workflowRef(workflow, STAGE_WORKFLOW)],
        [FINALIZE_WORKFLOW, workflowRef(workflow, FINALIZE_WORKFLOW)],
    ] as const;
    const failures = refs
        .filter((entry) => entry[1] === null || !COMMIT_PATTERN.test(entry[1]))
        .map((entry) => `${entry[0]} is pinned to ${entry[1] ?? 'nothing'}`);
    if (failures.length > 0) {
        return result(
            id,
            'fail',
            `${failures.join(' and ')}; reusable workflows must use full 40-character commit SHAs.`,
        );
    }
    return result(id, 'pass', 'both reusable workflows use full 40-character commit SHAs.');
}

function npmTokenCheck(context: CheckContext): CheckResult {
    const id = 'no-npm-token';
    const findings = scanWorkflows(context.workflows, (line) =>
        TOKEN_PATTERNS.some((pattern) => pattern.test(line)));
    if (findings.length > 0) {
        return result(
            id,
            'fail',
            `an npm publishing token appears in ${findings.join(', ')}; quoin uses OIDC only.`,
        );
    }
    return result(id, 'pass', 'no npm publishing token appears in any workflow.');
}

function directPublishCheck(context: CheckContext): CheckResult {
    const id = 'no-direct-publish';
    const others = context.workflows.filter((file) => file.name !== CALLER_WORKFLOW_FILENAME);
    const findings = scanWorkflows(others, (line) => line.includes(DIRECT_PUBLISH_COMMAND));
    if (findings.length > 0) {
        return result(
            id,
            'fail',
            `npm publish appears in ${findings.join(', ')}; publishing must go through quoin.`,
        );
    }
    return result(id, 'pass', 'no workflow publishes outside quoin.');
}

function scanWorkflows(
    workflows: readonly WorkflowFile[],
    matches: (line: string) => boolean,
): string[] {
    const findings: string[] = [];
    for (const file of workflows) {
        const lines = file.content.split('\n');
        for (const [index, line] of lines.entries()) {
            if (matches(line)) {
                findings.push(`${WORKFLOWS_DIRECTORY}/${file.name}:${String(index + 1)}`);
            }
        }
    }
    return findings;
}
