import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
    releaseLayerFailure,
    releaseNoteFailure,
} from '../../scripts/release/protocol-pin-policy.mts';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('release implementation checkpoint', () => {
    it('allows no runtime changes above the baked protocol pin', () => {
        const output = execFileSync(
            process.execPath,
            ['scripts/release/check-protocol-pin.mts'],
            { cwd: root, encoding: 'utf8' },
        );
        expect(output).toContain('covers the complete release implementation');
    });

    it('permits only package and lockfile version fields', () => {
        const packageBefore = JSON.stringify({ version: '1.0.0', scripts: { test: 'vitest' } });
        const packageAfter = JSON.stringify({ version: '1.0.1', scripts: { test: 'vitest' } });
        const packageAttack = JSON.stringify({ version: '1.0.1', scripts: { test: 'true' } });
        expect(releaseLayerFailure('package.json', packageBefore, packageAfter)).toBeNull();
        expect(releaseLayerFailure('package.json', packageBefore, packageAttack))
            .toContain('more than its permitted release fields');

        const lockBefore = JSON.stringify({ version: '1.0.0', packages: { '': { version: '1.0.0' }, x: { version: '2.0.0' } } });
        const lockAfter = JSON.stringify({ version: '1.0.1', packages: { '': { version: '1.0.1' }, x: { version: '2.0.0' } } });
        const lockAttack = JSON.stringify({ version: '1.0.1', packages: { '': { version: '1.0.1' }, x: { version: '3.0.0' } } });
        expect(releaseLayerFailure('package-lock.json', lockBefore, lockAfter)).toBeNull();
        expect(releaseLayerFailure('package-lock.json', lockBefore, lockAttack))
            .toContain('more than its permitted release fields');
    });

    it('permits only the exact baked and reusable-workflow SHA literals', () => {
        const pin = (sha: string, suffix = ''): string =>
            `export const SALLYPORT_WORKFLOW_SHA = '${sha}';\n${suffix}`;
        expect(releaseLayerFailure('src/cli/pins.ts', pin('a'.repeat(40)), pin('b'.repeat(40))))
            .toBeNull();
        expect(releaseLayerFailure(
            'src/cli/pins.ts',
            pin('a'.repeat(40)),
            pin('b'.repeat(40), 'export const bypass = true;\n'),
        )).toContain('more than its permitted release fields');

        const caller = (sha: string, permission = 'read'): string => [
            `permissions: { contents: ${permission} }`,
            `uses: zsumz/sallyport/.github/workflows/stage.yml@${sha}`,
            `uses: zsumz/sallyport/.github/workflows/finalize.yml@${sha}`,
        ].join('\n');
        expect(releaseLayerFailure(
            '.github/workflows/sallyport.yml', caller('a'.repeat(40)), caller('b'.repeat(40)),
        )).toBeNull();
        expect(releaseLayerFailure(
            '.github/workflows/sallyport.yml', caller('a'.repeat(40)), caller('b'.repeat(40), 'write'),
        )).toContain('more than its permitted release fields');
    });

    it('allows only a newly added note for the current release version', () => {
        expect(releaseNoteFailure('A', 'docs/releases/v1.2.3.md', '1.2.3')).toBeNull();
        expect(releaseNoteFailure('M', 'docs/releases/v1.2.3.md', '1.2.3'))
            .toContain('must be newly added');
        expect(releaseNoteFailure('A', 'docs/releases/v9.9.9.md', '1.2.3'))
            .toContain('is not the current release note');
    });
});
