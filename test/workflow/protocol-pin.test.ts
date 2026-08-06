import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
    releaseFileFailure,
    releaseLayerFailure,
    releaseShaAgreementFailure,
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

    it('allows only self-referential pins above the checkpoint', () => {
        expect(releaseFileFailure('.github/workflows/sallyport.yml')).toBeNull();
        expect(releaseFileFailure('src/cli/pins.ts')).toBeNull();
        expect(releaseFileFailure('package.json')).toContain('finalized in the implementation checkpoint');
        expect(releaseFileFailure('package-lock.json')).toContain('finalized in the implementation checkpoint');
        expect(releaseFileFailure('docs/releases/v1.2.3.md'))
            .toContain('finalized in the implementation checkpoint');
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

    it('requires the packaged and reusable-workflow SHAs to equal the checkpoint', () => {
        const a = 'a'.repeat(40);
        const b = 'b'.repeat(40);
        const c = 'c'.repeat(40);
        const pin = (sha: string): string =>
            `export const SALLYPORT_WORKFLOW_SHA = '${sha}';\n`;
        const caller = (stage: string, finalize: string): string => [
            `uses: zsumz/sallyport/.github/workflows/stage.yml@${stage}`,
            `uses: zsumz/sallyport/.github/workflows/finalize.yml@${finalize}`,
        ].join('\n');

        expect(releaseShaAgreementFailure(pin(a), caller(a, a), a)).toBeNull();
        expect(releaseShaAgreementFailure(pin(a), caller(b, b), a))
            .toContain('release SHA values must equal the protocol checkpoint');
        expect(releaseShaAgreementFailure(pin(a), caller(b, c), a))
            .toContain('release SHA values must equal the protocol checkpoint');
    });
});
