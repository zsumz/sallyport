import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    checkLabel,
    formatCheckReport,
    runCheck,
    SIGNING_KEY_FILE,
    type CheckReport,
} from '../../../src/cli/check.ts';
import { runInit } from '../../../src/cli/init.ts';
import {
    CALLER_WORKFLOW_FILE,
    FINALIZE_WORKFLOW,
    GENERATED_MARKER,
    WORKFLOWS_DIRECTORY,
} from '../../../src/cli/template.ts';
import { runCommand } from '../../../src/report/exec.ts';
import {
    createConsumer,
    FIXTURE_SHA,
    makeTempRoot,
    OTHER_SHA,
    readJsonFile,
    readTextFile,
    removeTempRoot,
    setGitRemote,
    writeJsonFile,
    writeTextFile,
    type Consumer,
} from './fixture.ts';

interface Breakage {
    id: string;
    break: (dir: string) => void;
}

const ALL_CHECK_IDS = [
    'package-public',
    'lockfile-matches',
    'repository-remote',
    'release-check-script',
    'release-smoke-script',
    'release-notes-directory',
    'signing-key',
    'caller-workflow',
    'workflow-sha-match',
    'workflow-sha-length',
    'no-npm-token',
    'no-direct-publish',
];

const BREAKAGES: Breakage[] = [
    {
        id: 'package-public',
        break: (dir) => {
            patchManifest(dir, (manifest) => ({ ...manifest, private: true }));
        },
    },
    {
        id: 'lockfile-matches',
        break: (dir) => {
            const lock = readJsonFile(path.join(dir, 'package-lock.json')) as Record<string, unknown>;
            writeJsonFile(path.join(dir, 'package-lock.json'), { ...lock, version: '9.9.9' });
        },
    },
    {
        id: 'repository-remote',
        break: (dir) => {
            setGitRemote(dir, 'git@github.com:zsumz/somewhere-else.git');
        },
    },
    {
        id: 'release-check-script',
        break: (dir) => {
            patchScripts(dir, 'release:check');
        },
    },
    {
        id: 'release-smoke-script',
        break: (dir) => {
            patchScripts(dir, 'release:smoke');
        },
    },
    {
        id: 'release-notes-directory',
        break: (dir) => {
            rmSync(path.join(dir, 'docs', 'releases'), { recursive: true, force: true });
        },
    },
    {
        id: 'signing-key',
        break: (dir) => {
            rmSync(path.join(dir, SIGNING_KEY_FILE), { force: true });
        },
    },
    {
        id: 'caller-workflow',
        break: (dir) => {
            const file = path.join(dir, CALLER_WORKFLOW_FILE);
            writeFileSync(file, readTextFile(file).replace(GENERATED_MARKER, '# hand written'));
        },
    },
    {
        id: 'workflow-sha-match',
        break: (dir) => {
            const file = path.join(dir, CALLER_WORKFLOW_FILE);
            writeFileSync(
                file,
                readTextFile(file).replace(
                    `${FINALIZE_WORKFLOW}@${FIXTURE_SHA}`,
                    `${FINALIZE_WORKFLOW}@${OTHER_SHA}`,
                ),
            );
        },
    },
    {
        id: 'workflow-sha-length',
        break: (dir) => {
            const file = path.join(dir, CALLER_WORKFLOW_FILE);
            writeFileSync(file, readTextFile(file).replaceAll(FIXTURE_SHA, 'main'));
        },
    },
    {
        id: 'no-npm-token',
        break: (dir) => {
            writeTextFile(
                path.join(dir, WORKFLOWS_DIRECTORY, 'ci.yml'),
                'name: ci\njobs:\n  build:\n    steps:\n      - env:\n'
                + '          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n',
            );
        },
    },
    {
        id: 'no-direct-publish',
        break: (dir) => {
            writeTextFile(
                path.join(dir, WORKFLOWS_DIRECTORY, 'legacy-release.yml'),
                'name: legacy\njobs:\n  publish:\n    steps:\n      - run: npm publish\n',
            );
        },
    },
];

let root = '';
let consumer: Consumer;

beforeEach(async () => {
    root = makeTempRoot('check');
    consumer = createConsumer(root);
    writeTextFile(path.join(consumer.dir, SIGNING_KEY_FILE), 'PUBLIC KEY\n');
    await runInit({
        dir: consumer.dir,
        strict: true,
        upgrade: false,
        force: false,
        sha: FIXTURE_SHA,
        exec: runCommand,
        log: () => undefined,
    });
});

afterEach(() => {
    removeTempRoot(root);
});

async function check(dir: string = consumer.dir): Promise<CheckReport> {
    return runCheck({ dir, exec: runCommand });
}

function statusOf(report: CheckReport, id: string): string {
    return report.checks.find((entry) => entry.id === id)?.status ?? 'missing';
}

function patchManifest(
    dir: string,
    update: (manifest: Record<string, unknown>) => Record<string, unknown>,
): void {
    const file = path.join(dir, 'package.json');
    writeJsonFile(file, update(readJsonFile(file) as Record<string, unknown>));
}

function patchScripts(dir: string, remove: string): void {
    patchManifest(dir, (manifest) => {
        const scripts = Object.fromEntries(
            Object.entries(manifest.scripts as Record<string, string>)
                .filter(([name]) => name !== remove),
        );
        return { ...manifest, scripts };
    });
}

describe('runCheck on a complete strict fixture', () => {
    it('passes every assertion', async () => {
        const report = await check();

        expect(report.checks.map((entry) => entry.id)).toEqual(ALL_CHECK_IDS);
        expect(report.checks.filter((entry) => entry.status !== 'pass')).toEqual([]);
        expect(report.ok).toBe(true);
    });

    it('accepts an SSH host alias remote with matching coordinates', async () => {
        setGitRemote(consumer.dir, 'git@github-zsumz:zsumz/fake.git');

        const report = await check();

        expect(statusOf(report, 'repository-remote')).toBe('pass');
    });

    it('rejects an SSH host alias remote with different coordinates', async () => {
        setGitRemote(consumer.dir, 'git@github-zsumz:zsumz/somewhere-else.git');

        const report = await check();

        expect(statusOf(report, 'repository-remote')).toBe('fail');
    });

    it('prints one PASS line per assertion', async () => {
        const text = formatCheckReport(await check());

        expect(text.trimEnd().split('\n')).toEqual(
            ALL_CHECK_IDS.map((id) => `PASS ${checkLabel(id)}`),
        );
        expect(text).toContain('PASS package is public');
        expect(text).toContain('PASS no direct npm publish workflow exists');
    });
});

describe.each(BREAKAGES)('runCheck detects a broken $id', (breakage) => {
    it('flips exactly that assertion to FAIL', async () => {
        breakage.break(consumer.dir);

        const report = await check();

        expect(statusOf(report, breakage.id)).toBe('fail');
        expect(report.ok).toBe(false);
        expect(report.checks.find((entry) => entry.id === breakage.id)?.message)
            .not.toBe('');
    });

    it('reports the failure with a label and a reason', async () => {
        breakage.break(consumer.dir);

        const text = formatCheckReport(await check());

        expect(text).toContain(`FAIL ${checkLabel(breakage.id)}`);
    });
});

describe('runCheck standard profile', () => {
    it('reports the strict-only artifacts as skipped instead of failing', async () => {
        const standardRoot = makeTempRoot('check-standard');
        const standard = createConsumer(standardRoot);
        rmSync(path.join(standard.dir, 'docs'), { recursive: true, force: true });
        await runInit({
            dir: standard.dir,
            strict: false,
            upgrade: false,
            force: false,
            sha: FIXTURE_SHA,
            exec: runCommand,
            log: () => undefined,
        });

        const report = await check(standard.dir);

        expect(statusOf(report, 'release-notes-directory')).toBe('skip');
        expect(statusOf(report, 'signing-key')).toBe('skip');
        expect(report.ok).toBe(true);
        expect(formatCheckReport(report)).toContain('SKIP public signing key exists');
        removeTempRoot(standardRoot);
    });
});

describe('runCheck standalone', () => {
    it('fails the workflow assertions when no sallyport workflow exists', async () => {
        const bareRoot = makeTempRoot('check-bare');
        const bare = createConsumer(bareRoot);

        const report = await check(bare.dir);

        expect(statusOf(report, 'caller-workflow')).toBe('fail');
        expect(statusOf(report, 'workflow-sha-match')).toBe('fail');
        expect(statusOf(report, 'workflow-sha-length')).toBe('fail');
        expect(statusOf(report, 'no-npm-token')).toBe('pass');
        expect(statusOf(report, 'no-direct-publish')).toBe('pass');
        expect(report.checks.find((entry) => entry.id === 'caller-workflow')?.message)
            .toContain('npx sallyport init');
        removeTempRoot(bareRoot);
    });

    it('fails every package assertion when package.json is missing', async () => {
        const emptyRoot = makeTempRoot('check-empty');

        const report = await check(emptyRoot);

        expect(statusOf(report, 'package-public')).toBe('fail');
        expect(statusOf(report, 'lockfile-matches')).toBe('fail');
        expect(statusOf(report, 'repository-remote')).toBe('fail');
        expect(statusOf(report, 'release-check-script')).toBe('fail');
        expect(report.ok).toBe(false);
        removeTempRoot(emptyRoot);
    });
});

describe('check --json shape', () => {
    it('emits checks with id, status and message plus ok', async () => {
        const report = await check();
        const serialized: unknown = JSON.parse(JSON.stringify(report));

        expect(serialized).toEqual({
            ok: true,
            checks: ALL_CHECK_IDS.map((id) => ({
                id,
                status: 'pass',
                message: expect.any(String) as unknown,
            })),
        });
    });

    it('reports ok false when any assertion fails', async () => {
        setGitRemote(consumer.dir, 'git@github.com:zsumz/other.git');

        expect((await check()).ok).toBe(false);
    });
});
