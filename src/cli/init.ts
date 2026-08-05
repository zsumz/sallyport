import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeRepositoryUrl, readPackageMetadata } from '../contract/package.ts';
import { RELEASE_NOTES_DIRECTORY } from '../contract/release.ts';
import type { CommandRunner } from '../contract/signing.ts';
import { formatCheckReport, runCheck, SIGNING_KEY_FILE } from './check.ts';
import { QUOIN_WORKFLOW_SHA, isPlaceholderSha, normalizeCommitSha } from './pins.ts';
import {
    ensureDirectory,
    errorMessage,
    readJsonFile,
    readStringMap,
    readTextFile,
} from './support.ts';
import {
    CALLER_WORKFLOW_FILE,
    hasGeneratedMarker,
    readWorkflowTemplate,
    renderCallerWorkflow,
    rewriteWorkflowPins,
    WORKFLOWS_DIRECTORY,
    type Profile,
} from './template.ts';

export interface InitOptions {
    dir: string;
    strict: boolean;
    upgrade: boolean;
    force: boolean;
    sha: string | undefined;
    exec: CommandRunner;
    log: (line: string) => void;
}

export const STRICT_DIRECTORIES = [RELEASE_NOTES_DIRECTORY, 'etc'] as const;

const REQUIRED_SCRIPTS = ['release:check', 'release:smoke'] as const;
const EXPECTED_PINS = 2;

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

export function npmTrustCommand(packageName: string, repository: string): string[] {
    return [
        `npm trust github ${packageName} \\`,
        `  --repository ${repository} \\`,
        '  --file quoin.yml \\',
        '  --environment npm-stage \\',
        '  --allow-stage-publish',
    ];
}

export function setupChecklist(profile: Profile, version: string): string[] {
    const steps = [
        'Create the npm-stage environment; restrict deployment refs to v* tags; no secrets.',
        'Create the github-release environment; restrict deployment refs to the default branch; no secrets.',
        ...profile === 'strict'
            ? [
                'Set repository variable QUOIN_SIGNER_FINGERPRINT to the 40-hex primary key fingerprint.',
                `Commit the public release signing key to ${SIGNING_KEY_FILE}.`,
            ]
            : [],
        'Run the npm trust command above; npm allows one trusted publisher per package.',
        'Set npm publishing access to require two-factor authentication and disallow tokens.',
        'Remove obsolete npm automation tokens.',
        `Commit release notes to ${RELEASE_NOTES_DIRECTORY}/v${version}.md before tagging.`,
    ];
    return [
        'One-time repository setup:',
        ...steps.map((step, index) => `  ${String(index + 1)}. ${step}`),
    ];
}

function detectRepository(dir: string, exec: CommandRunner): string {
    let url: string;
    try {
        url = exec('git', ['remote', 'get-url', 'origin'], { cwd: dir }).stdout.trim();
    } catch (error) {
        throw new Error(
            `Installation failed: git remote get-url origin failed: ${errorMessage(error).split('\n')[0] ?? ''}`,
            { cause: error },
        );
    }
    const repository = url === '' ? null : normalizeRepositoryUrl(url);
    if (repository === null) {
        throw new Error(
            `Installation failed: git remote origin ${url} must identify a github.com repository.`,
        );
    }
    return repository;
}

function resolveWorkflowSha(requested: string | undefined): string {
    if (requested !== undefined) {
        const normalized = normalizeCommitSha(requested);
        if (normalized === null) {
            throw new Error(
                'Installation failed: --sha must be a full 40-character commit SHA.',
            );
        }
        return normalized;
    }
    const pinned = normalizeCommitSha(QUOIN_WORKFLOW_SHA);
    if (pinned === null || isPlaceholderSha(pinned)) {
        throw new Error(
            'Installation failed: this build of quoin carries no pinned workflow commit;'
            + ' pass --sha <commit> until the first quoin release bakes one in.'
            + ' Reusable workflows are never pinned to a mutable ref.',
        );
    }
    return pinned;
}

async function generateCallerWorkflow(
    file: string,
    sha: string,
    profile: Profile,
): Promise<void> {
    const existing = await readTextFile(file);
    if (existing !== null) {
        throw new Error(
            `Installation failed: ${CALLER_WORKFLOW_FILE} already exists;`
            + ' rerun with --upgrade to update its pinned commit.',
        );
    }
    const template = await readWorkflowTemplate();
    await writeFile(file, renderCallerWorkflow(template, sha, profile));
}

// --upgrade rewrites the two pins and nothing else, so a consumer's profile and
// any surrounding structure survive the update.
async function upgradeCallerWorkflow(
    file: string,
    sha: string,
    force: boolean,
): Promise<void> {
    const existing = await readTextFile(file);
    if (existing === null) {
        throw new Error(
            `Installation failed: ${CALLER_WORKFLOW_FILE} does not exist;`
            + ' run npx quoin init to generate it.',
        );
    }
    if (!hasGeneratedMarker(existing) && !force) {
        throw new Error(
            `Installation failed: ${CALLER_WORKFLOW_FILE} does not start with the quoin`
            + ' generated-by marker; rerun with --force to upgrade it anyway.',
        );
    }
    const rewritten = rewriteWorkflowPins(existing, sha);
    if (rewritten.replaced !== EXPECTED_PINS) {
        throw new Error(
            `Installation failed: ${CALLER_WORKFLOW_FILE} must pin stage.yml and finalize.yml;`
            + ` found ${String(rewritten.replaced)} quoin workflow references.`,
        );
    }
    await writeFile(file, rewritten.content);
}

async function scriptWarnings(dir: string): Promise<string[]> {
    const manifest = await readJsonFile(path.join(dir, 'package.json'));
    const scripts = readStringMap(manifest, 'scripts');
    return REQUIRED_SCRIPTS
        .filter((script) => {
            const value = scripts[script];
            return value === undefined || value.trim() === '';
        })
        .map((script) => `package.json defines no ${script} script; quoin cannot release without it.`);
}

function declaredRepositoryMismatch(
    declared: string | undefined,
    repository: string,
): boolean {
    if (declared === undefined || declared.trim() === '') {
        return true;
    }
    const normalized = normalizeRepositoryUrl(declared);
    return normalized?.toLowerCase() !== repository.toLowerCase();
}
