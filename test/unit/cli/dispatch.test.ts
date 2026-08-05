import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    CHECK_USAGE,
    INIT_USAGE,
    runCli,
    USAGE,
} from '../../../src/cli/dispatch.ts';
import { CALLER_WORKFLOW_FILE } from '../../../src/cli/template.ts';
import { readsallyportVersion } from '../../../src/cli/version.ts';
import {
    createConsumer,
    createEffects,
    FIXTURE_SHA,
    makeTempRoot,
    removeTempRoot,
    type Consumer,
    type TestEffects,
} from './fixture.ts';

let root = '';
let consumer: Consumer;
let harness: TestEffects;

beforeEach(() => {
    root = makeTempRoot('dispatch');
    consumer = createConsumer(root);
    harness = createEffects(root, { cwd: consumer.dir });
});

afterEach(() => {
    removeTempRoot(root);
});

describe('runCli', () => {
    it('prints usage with no arguments', async () => {
        expect(await runCli([], harness.effects)).toBe(0);
        expect(harness.logs).toEqual([USAGE]);
    });

    it('prints usage for every help spelling', async () => {
        for (const flag of ['--help', '-h', 'help']) {
            expect(await runCli([flag], harness.effects)).toBe(0);
        }
        expect(harness.logs).toEqual([USAGE, USAGE, USAGE]);
        expect(USAGE).toContain('sallyport init [options]');
        expect(USAGE).toContain('sallyport check [options]');
    });

    it('prints command-specific help without running the command', async () => {
        for (const flag of ['--help', '-h', 'help']) {
            expect(await runCli(['init', flag], harness.effects)).toBe(0);
            expect(await runCli(['check', flag], harness.effects)).toBe(0);
        }

        expect(harness.logs).toEqual([
            INIT_USAGE, CHECK_USAGE,
            INIT_USAGE, CHECK_USAGE,
            INIT_USAGE, CHECK_USAGE,
        ]);
        expect(INIT_USAGE).toContain('--strict');
        expect(CHECK_USAGE).toContain('--remote');
    });

    it('prints the package version for every version spelling', async () => {
        const version = await readsallyportVersion();

        for (const flag of ['--version', '-v', 'version']) {
            expect(await runCli([flag], harness.effects)).toBe(0);
        }

        expect(harness.logs).toEqual([version, version, version]);
        expect(version).toMatch(/^\d+\.\d+\.\d+/u);
    });

    it('rejects an unknown command', async () => {
        await expect(runCli(['publish'], harness.effects))
            .rejects.toThrow('Unknown command publish; run sallyport --help.');
    });

    it('rejects an unknown internal command', async () => {
        await expect(runCli(['internal', 'nope'], harness.effects))
            .rejects.toThrow(/Unknown internal command nope; expected one of inspect-source/u);
    });

    it('rejects a missing internal command', async () => {
        await expect(runCli(['internal'], harness.effects))
            .rejects.toThrow(/Unknown internal command <missing>/u);
    });

    it('runs init against the working directory', async () => {
        expect(await runCli(['init', '--sha', FIXTURE_SHA], harness.effects)).toBe(0);
        expect(existsSync(path.join(consumer.dir, CALLER_WORKFLOW_FILE))).toBe(true);
    });

    it('runs check and exits nonzero when an assertion fails', async () => {
        expect(await runCli(['check'], harness.effects)).toBe(1);
        expect(harness.logs.join('\n')).toContain('FAIL caller workflow is generated correctly');
    });

    it('runs check --json and exits zero once the workflow is generated', async () => {
        await runCli(['init', '--sha', FIXTURE_SHA], harness.effects);
        harness.logs.length = 0;

        expect(await runCli(['check', '--json'], harness.effects)).toBe(0);

        const parsed: unknown = JSON.parse(harness.logs[0] ?? '');
        expect(parsed).toMatchObject({ ok: true });
        expect((parsed as { checks: unknown[] }).checks).toHaveLength(12);
    });

    it('dispatches internal commands', async () => {
        expect(await runCli([
            'internal', 'pack',
            '--consumer', consumer.dir,
            '--output', path.join(root, 'out'),
        ], harness.effects)).toBe(0);
        expect(existsSync(path.join(root, 'out', 'package.tgz'))).toBe(true);
    });

    it('rejects unknown flags on public commands', async () => {
        await expect(runCli(['check', '--verbose'], harness.effects))
            .rejects.toThrow('Argument parsing failed: --verbose is not a recognized flag.');
    });
});
