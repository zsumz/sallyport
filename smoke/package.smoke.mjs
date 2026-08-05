import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, smoke } from 'smoque';

const QUOIN_SHA = '0123456789abcdef0123456789abcdef01234567';

smoke.suite('quoin package', { tags: ['package'] }, async (t) => {
    const root = t.repoRoot();
    const work = await t.tempDir('quoin-package');
    const packed = work.path('packed');
    const npmCache = work.path('npm-cache');
    const fixtureDir = work.path('fixture');
    const consumerDir = work.path('consumer');

    await t.step('required tools are available', async () => {
        await t.tools.node({ minVersion: 22 });
        await t.tools.npm({ minVersion: 10 });
    });

    // Inside a Quoin release the exact candidate tarball arrives through
    // the environment; everywhere else the smoke packs its own fixture.
    const suppliedTarball = process.env.QUOIN_TARBALL;
    const tarball = suppliedTarball !== undefined && suppliedTarball !== ''
        ? suppliedTarball
        : await t.step('build and pack fixture tarball', async () => {
            await t.cmd('npm', ['run', 'build'], { cwd: root });
            await t.fs.mkdir(packed);
            await t.fs.mkdir(npmCache);
            const result = await t.cmd(
                'npm',
                ['pack', '--json', '--ignore-scripts', '--pack-destination', packed],
                {
                    cwd: root,
                    env: { NPM_CONFIG_CACHE: npmCache },
                },
            );
            const report = JSON.parse(result.stdout);
            const entries = Array.isArray(report) ? report : Object.values(report);
            if (entries.length !== 1) {
                throw new Error('expected npm pack to produce exactly one tarball');
            }
            return resolve(packed, entries[0].filename);
        });

    const version = process.env.QUOIN_VERSION
        ?? JSON.parse(readFileSync(root.path('package.json'), 'utf8')).version;

    await t.step('tarball contains the CLI, templates, and schemas', async () => {
        await expect
            .archive(tarball)
            .toContainEntries([
                'package/LICENSE',
                'package/README.md',
                'package/dist/cli/main.js',
                'package/dist/cli/pins.js',
                'package/schemas/candidate.schema.json',
                'package/schemas/release.schema.json',
                'package/templates/quoin.yml',
                'package/package.json',
            ]);
    });

    await t.step('tarball excludes sources, tests, docs, and workflows', async () => {
        await expect
            .archive(tarball)
            .not.toContainEntries([
                'package/src/cli/main.ts',
                'package/test/tsconfig.json',
                'package/docs/protocol.md',
                'package/.github/workflows/stage.yml',
                'package/vitest.config.ts',
                'package/eslint.config.mjs',
                'package/smoke/package.smoke.mjs',
            ]);
    });

    const fixture = await t.step('create clean npm fixture', async () => {
        return await t.npm.fixture({
            dir: fixtureDir,
            packageJson: {
                private: true,
                type: 'module',
                dependencies: {},
            },
        });
    });

    await t.step('install packed package', async () => {
        await fixture.install(tarball, {
            scripts: 'ignore',
            audit: false,
            fund: false,
            packageLock: false,
        });
    });

    const cli = resolve(fixtureDir, 'node_modules', 'quoin', 'dist', 'cli', 'main.js');

    await t.step('installed CLI reports its version', async () => {
        const result = await t.cmd('node', [cli, '--version'], { cwd: fixtureDir });
        if (result.stdout.trim() !== version) {
            throw new Error(
                `expected version ${version}, got ${result.stdout.trim()}`,
            );
        }
    });

    await t.step('check fails loudly in an unconfigured project', async () => {
        const result = await t.cmd('node', [cli, 'check'], {
            cwd: fixtureDir,
            check: false,
        });
        if (result.exitCode === 0) {
            throw new Error('check must fail in an unconfigured project');
        }
        if (!result.stdout.includes('FAIL')) {
            throw new Error('check must report FAIL lines');
        }
    });

    await t.step('init generates the pinned caller workflow', async () => {
        await t.fs.mkdir(consumerDir);
        await t.fs.writeJson(resolve(consumerDir, 'package.json'), {
            name: 'quoin-smoke-consumer',
            version: '1.2.3',
            description: 'quoin smoke consumer',
            repository: {
                type: 'git',
                url: 'git+https://github.com/zsumz/quoin-smoke-consumer.git',
            },
            license: 'MIT',
            scripts: {
                'release:check': 'node -e "process.exit(0)"',
                'release:smoke': 'node -e "process.exit(0)"',
            },
        });
        await t.fs.writeJson(resolve(consumerDir, 'package-lock.json'), {
            name: 'quoin-smoke-consumer',
            version: '1.2.3',
            lockfileVersion: 3,
            requires: true,
            packages: {
                '': {
                    name: 'quoin-smoke-consumer',
                    version: '1.2.3',
                    license: 'MIT',
                },
            },
        });
        await t.cmd('git', ['init', '--quiet', '-b', 'main'], { cwd: consumerDir });
        await t.cmd('git', [
            'remote',
            'add',
            'origin',
            'git@github.com:zsumz/quoin-smoke-consumer.git',
        ], { cwd: consumerDir });

        const init = await t.cmd('node', [cli, 'init', '--sha', QUOIN_SHA], {
            cwd: consumerDir,
            check: false,
        });
        if (init.exitCode !== 0) {
            throw new Error(
                `init must succeed on a prepared consumer\n${init.stdout}\n${init.stderr}`,
            );
        }

        const workflow = readFileSync(
            resolve(consumerDir, '.github', 'workflows', 'quoin.yml'),
            'utf8',
        );
        if (!workflow.startsWith('# Generated by quoin.')) {
            throw new Error('generated workflow must carry the generated-by marker');
        }
        const pins = workflow.match(/@[0-9a-f]{40}/gu) ?? [];
        if (pins.length !== 2 || pins[0] !== `@${QUOIN_SHA}` || pins[1] !== `@${QUOIN_SHA}`) {
            throw new Error('both reusable workflows must pin the supplied SHA');
        }
    });

    await t.step('check passes on the generated consumer', async () => {
        const result = await t.cmd('node', [cli, 'check', '--json'], {
            cwd: consumerDir,
            check: false,
        });
        const report = JSON.parse(result.stdout);
        if (report.ok !== true || result.exitCode !== 0) {
            throw new Error(`check must pass on a generated consumer\n${result.stdout}`);
        }
    });
});
