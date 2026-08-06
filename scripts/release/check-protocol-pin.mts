import { execFileSync } from 'node:child_process';

import { SALLYPORT_WORKFLOW_SHA } from '../../src/cli/pins.ts';
import {
    releaseLayerFailure,
    releaseNoteFailure,
    SEMANTIC_RELEASE_FILES,
} from './protocol-pin-policy.mts';

function git(args: readonly string[]): string {
    return execFileSync('git', [...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function content(revision: string, file: string): string {
    return execFileSync('git', ['show', `${revision}:${file}`], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

try {
    git(['cat-file', '-e', `${SALLYPORT_WORKFLOW_SHA}^{commit}`]);
} catch {
    throw new Error(
        `Protocol pin ${SALLYPORT_WORKFLOW_SHA} is unavailable; fetch full history before release qualification.`,
    );
}

try {
    git(['merge-base', '--is-ancestor', SALLYPORT_WORKFLOW_SHA, 'HEAD']);
} catch {
    throw new Error(
        `Protocol pin ${SALLYPORT_WORKFLOW_SHA} must be an ancestor of HEAD.`,
    );
}

const changed = git([
    'diff', '--name-status', '--no-renames', `${SALLYPORT_WORKFLOW_SHA}..HEAD`,
])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
        const [status = '', file = ''] = line.split('\t');
        return { status, file };
    });
const headPackage = JSON.parse(content('HEAD', 'package.json')) as { version?: unknown };
if (typeof headPackage.version !== 'string' || headPackage.version === '') {
    throw new Error('HEAD package.json must declare a release version.');
}
const failures: string[] = [];
for (const change of changed) {
    if (SEMANTIC_RELEASE_FILES.has(change.file)) {
        if (change.status !== 'M') {
            failures.push(`${change.file} must exist at both the checkpoint and HEAD.`);
            continue;
        }
        const failure = releaseLayerFailure(
            change.file,
            content(SALLYPORT_WORKFLOW_SHA, change.file),
            content('HEAD', change.file),
        );
        if (failure !== null) failures.push(failure);
        continue;
    }
    if (/^docs\/releases\/v[^/]+\.md$/u.test(change.file)) {
        const failure = releaseNoteFailure(change.status, change.file, headPackage.version);
        if (failure !== null) failures.push(failure);
        continue;
    }
    failures.push(`${change.file} is outside the release layer.`);
}
if (failures.length > 0) {
    throw new Error([
        `Protocol pin ${SALLYPORT_WORKFLOW_SHA} does not cover the complete release implementation:`,
        ...failures.map((failure) => `- ${failure}`),
        'Create a full implementation checkpoint, then update only the release layer to pin it.',
    ].join('\n'));
}

process.stdout.write(
    `Protocol pin ${SALLYPORT_WORKFLOW_SHA} covers the complete release implementation.\n`,
);
