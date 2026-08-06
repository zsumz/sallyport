import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('smoke dependency isolation', () => {
    it('does not run an environment-poisoning or detached postinstall', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sallyport-postinstall-'));
        const githubEnv = join(root, 'github-env');
        const githubPath = join(root, 'github-path');
        try {
            writeFixture(root);
            const result = spawnSync(
                'npm',
                ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
                {
                    cwd: root,
                    encoding: 'utf8',
                    env: { ...process.env, GITHUB_ENV: githubEnv, GITHUB_PATH: githubPath },
                },
            );
            await new Promise((resolve) => setTimeout(resolve, 150));

            expect(result.status, result.stderr).toBe(0);
            expect(existsSync(join(root, 'postinstall-ran'))).toBe(false);
            expect(existsSync(join(root, 'detached-ran'))).toBe(false);
            expect(existsSync(githubEnv)).toBe(false);
            expect(existsSync(githubPath)).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

function writeFixture(root: string): void {
    writeFileSync(join(root, 'package.json'), JSON.stringify({
        name: 'sallyport-postinstall-fixture',
        version: '1.0.0',
        private: true,
        scripts: { postinstall: 'node postinstall.mjs' },
    }));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
        name: 'sallyport-postinstall-fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
            '': {
                name: 'sallyport-postinstall-fixture',
                version: '1.0.0',
                hasInstallScript: true,
            },
        },
    }));
    writeFileSync(join(root, 'postinstall.mjs'), [
        'import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from \'node:fs\';',
        'import { join } from \'node:path\';',
        'import { spawn } from \'node:child_process\';',
        'const root = process.cwd();',
        'writeFileSync(join(root, \'postinstall-ran\'), \'ran\');',
        'const bin = join(root, \'poison-bin\');',
        'mkdirSync(bin);',
        'writeFileSync(join(bin, \'node\'), \'#!/bin/sh\\ncat >/dev/null\\nexit 0\\n\');',
        'chmodSync(join(bin, \'node\'), 0o755);',
        'appendFileSync(process.env.GITHUB_PATH, `${bin}\\n`);',
        'const poison = join(root, \'poison.sh\');',
        'writeFileSync(poison, \'node() { cat >/dev/null; return 0; }\\nexport -f node\\n\');',
        'appendFileSync(process.env.GITHUB_ENV, `BASH_ENV=${poison}\\n`);',
        'const detached = join(root, \'detached-ran\');',
        'const code = `setTimeout(() => require(\'node:fs\').writeFileSync(${JSON.stringify(detached)}, \'ran\'), 50)`;',
        'const child = spawn(process.execPath, [\'-e\', code], {',
        '    detached: true, stdio: \'ignore\',',
        '    env: { ...process.env, RUNNER_TRACKING_ID: \'\' },',
        '});',
        'child.unref();',
    ].join('\n'));
}
