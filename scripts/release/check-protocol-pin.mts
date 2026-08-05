import { execFileSync } from 'node:child_process';

import { SALLYPORT_WORKFLOW_SHA } from '../../src/cli/pins.ts';

const RELEASE_LAYER_FILES = new Set([
    '.github/workflows/sallyport.yml',
    'package-lock.json',
    'package.json',
    'src/cli/pins.ts',
]);

function git(args: readonly string[]): string {
    return execFileSync('git', [...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function isReleaseLayerFile(file: string): boolean {
    return RELEASE_LAYER_FILES.has(file)
        || /^docs\/releases\/v[^/]+\.md$/u.test(file);
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

const changed = git(['diff', '--name-only', `${SALLYPORT_WORKFLOW_SHA}..HEAD`])
    .split('\n')
    .filter((file) => file !== '');
const runtimeChanges = changed.filter((file) => !isReleaseLayerFile(file));
if (runtimeChanges.length > 0) {
    throw new Error([
        `Protocol pin ${SALLYPORT_WORKFLOW_SHA} predates release runtime changes:`,
        ...runtimeChanges.map((file) => `- ${file}`),
        'Create a full implementation checkpoint, then update only the release layer to pin it.',
    ].join('\n'));
}

process.stdout.write(
    `Protocol pin ${SALLYPORT_WORKFLOW_SHA} covers the complete release implementation.\n`,
);
