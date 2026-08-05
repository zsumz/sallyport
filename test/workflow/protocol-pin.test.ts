import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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
});
