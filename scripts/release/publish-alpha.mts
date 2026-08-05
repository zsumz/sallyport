import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    assertCandidateTarball,
    hashTarball,
} from '../../src/candidate/inspect.ts';
import { SALLYPORT_WORKFLOW_SHA } from '../../src/cli/pins.ts';
import { deriveDistTag } from '../../src/contract/semver.ts';
import { runCommand } from '../../src/report/exec.ts';

interface Manifest {
    name?: unknown;
    version?: unknown;
}

const cwd = process.cwd();
const dryRun = parseArgs(process.argv.slice(2));
const tarball = process.env.SALLYPORT_TARBALL;
if (tarball === undefined || !path.isAbsolute(tarball)) {
    throw new Error('SALLYPORT_TARBALL must be an absolute path to the qualified tarball.');
}

const manifest = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')) as Manifest;
if (manifest.name !== 'sallyport' || typeof manifest.version !== 'string') {
    throw new Error('package.json must identify a versioned sallyport package.');
}

const bytes = await readFile(tarball);
const candidate = assertCandidateTarball(bytes);
if (candidate.name !== manifest.name || candidate.version !== manifest.version) {
    throw new Error(
        `tarball contains ${candidate.name}@${candidate.version}; expected `
        + `${manifest.name}@${manifest.version}.`,
    );
}

const status = runCommand('git', ['status', '--short'], { cwd }).stdout.trim();
if (status !== '') {
    throw new Error(`publish requires a clean worktree:\n${status}`);
}
runCommand('git', ['verify-commit', 'HEAD'], { cwd });

const decision = deriveDistTag(candidate.version);
if (!('distTag' in decision) || decision.distTag !== 'alpha') {
    throw new Error(`${candidate.version} is not an alpha release.`);
}

const workflowSha = runCommand('git', [
    'log', '-1', '--format=%H', '--',
    '.github/workflows/stage.yml',
    '.github/workflows/finalize.yml',
], { cwd }).stdout.trim();
if (workflowSha !== SALLYPORT_WORKFLOW_SHA) {
    throw new Error(`workflow pin ${SALLYPORT_WORKFLOW_SHA} must equal ${workflowSha}.`);
}
if (!dryRun) {
    verifyReleaseTag(candidate.version);
}

const digest = hashTarball(bytes);
const smoke = runCommand('npm', ['run', 'release:smoke'], {
    cwd,
    env: {
        ...process.env,
        SALLYPORT_DIST_TAG: decision.distTag,
        SALLYPORT_PACKAGE: candidate.name,
        SALLYPORT_TARBALL: tarball,
        SALLYPORT_VERSION: candidate.version,
    },
});
process.stdout.write(smoke.stdout);
process.stdout.write(
    `${dryRun ? 'Checking' : 'Publishing'} ${candidate.name}@${candidate.version} `
    + `from ${tarball}\nsha256 ${digest.sha256}\n`,
);

const args = ['publish', tarball, '--tag', decision.distTag, '--access', 'public', '--json'];
if (dryRun) {
    args.push('--dry-run');
}
const result = spawnSync('npm', args, {
    cwd,
    shell: false,
    stdio: 'inherit',
});
if (result.status !== 0) {
    throw new Error(result.error?.message ?? `npm publish exited ${String(result.status)}.`);
}

function parseArgs(args: readonly string[]): boolean {
    if (args.length === 0) {
        return false;
    }
    if (args.length === 1 && args[0] === '--dry-run') {
        return true;
    }
    throw new Error('publish-alpha accepts only --dry-run.');
}

function verifyReleaseTag(version: string): void {
    const tag = `v${version}`;
    const head = runCommand('git', ['rev-parse', 'HEAD'], { cwd }).stdout.trim();
    const tagged = runCommand('git', ['rev-list', '-n', '1', tag], { cwd }).stdout.trim();
    if (tagged !== head) {
        throw new Error(`${tag} must point at HEAD ${head}.`);
    }
    runCommand('git', ['verify-tag', tag], { cwd });
}
