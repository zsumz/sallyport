import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SIGNING_KEY_FILE } from '../../../src/cli/check.ts';
import { runInit, type InitOptions } from '../../../src/cli/init.ts';
import { SALLYPORT_WORKFLOW_SHA } from '../../../src/cli/pins.ts';
import {
    CALLER_WORKFLOW_FILE,
    FINALIZE_WORKFLOW,
    GENERATED_MARKER,
    SIGNER_FINGERPRINT_LINE,
    STAGE_WORKFLOW,
    workflowRef,
} from '../../../src/cli/template.ts';
import { runCommand } from '../../../src/report/exec.ts';
import {
    createConsumer,
    FIXTURE_SHA,
    makeTempRoot,
    OTHER_SHA,
    readTextFile,
    removeTempRoot,
    writeTextFile,
    type Consumer,
} from './fixture.ts';

let root = '';
let consumer: Consumer;
let logs: string[] = [];

beforeEach(() => {
    root = makeTempRoot('init');
    consumer = createConsumer(root);
    logs = [];
});

afterEach(() => {
    removeTempRoot(root);
});

function options(overrides: Partial<InitOptions> = {}): InitOptions {
    return {
        dir: consumer.dir,
        strict: false,
        upgrade: false,
        force: false,
        sha: FIXTURE_SHA,
        exec: runCommand,
        log: (line) => {
            logs.push(line);
        },
        ...overrides,
    };
}

function workflowFile(): string {
    return path.join(consumer.dir, CALLER_WORKFLOW_FILE);
}

function generated(): string {
    return readTextFile(workflowFile());
}

describe('runInit', () => {
    it('generates the standard caller workflow pinned to the requested commit', async () => {
        const status = await runInit(options());

        const content = generated();
        expect(status).toBe(0);
        expect(content.split('\n')[0]).toBe(GENERATED_MARKER);
        expect(content).toContain('name: sallyport');
        expect(content).toContain('permissions: {}');
        expect(content).toContain('group: sallyport-${{ github.repository }}');
        expect(content).toContain('cancel-in-progress: false');
        expect(content).toContain('profile: standard');
        expect(content).not.toContain('signer_fingerprint');
        expect(content).not.toContain('__SALLYPORT_');
        expect(workflowRef(content, STAGE_WORKFLOW)).toBe(FIXTURE_SHA);
        expect(workflowRef(content, FINALIZE_WORKFLOW)).toBe(FIXTURE_SHA);
    });

    it('keeps the caller workflow job graph from the design', async () => {
        await runInit(options());

        const content = generated();
        expect(content).toContain('    if: github.event_name == \'push\'');
        expect(content).toContain('    if: github.event_name == \'workflow_dispatch\'');
        expect(content).toContain('      actions: read\n      contents: read\n      id-token: write');
        expect(content).toContain('      actions: read\n      contents: write');
        expect(content).toContain('candidate_run_id: ${{ inputs.candidate_run_id }}');
    });

    it('generates the strict profile with both signer fingerprint inputs', async () => {
        const status = await runInit(options({ strict: true }));

        const content = generated();
        expect(content).toContain('profile: strict');
        expect(content.split('\n').filter((line) => line === SIGNER_FINGERPRINT_LINE))
            .toHaveLength(2);
        expect(content).not.toContain('__SALLYPORT_');
        expect(status).toBe(1);
        expect(logs.join('\n')).toContain('FAIL public signing key exists');
    });

    it('reports a clean strict install once the signing key is committed', async () => {
        writeTextFile(path.join(consumer.dir, SIGNING_KEY_FILE), 'PUBLIC KEY\n');

        expect(await runInit(options({ strict: true }))).toBe(0);
        expect(logs.join('\n')).toContain('PASS public signing key exists');
    });

    it('creates the strict directories', async () => {
        await runInit(options({ strict: true }));

        expect(existsSync(path.join(consumer.dir, 'docs', 'releases'))).toBe(true);
        expect(existsSync(path.join(consumer.dir, 'etc'))).toBe(true);
        expect(logs.join('\n')).toContain('etc/release-signing-key.asc');
    });

    it('lowercases and validates the requested commit', async () => {
        await runInit(options({ sha: FIXTURE_SHA.toUpperCase() }));

        expect(workflowRef(generated(), STAGE_WORKFLOW)).toBe(FIXTURE_SHA);
    });

    it('rejects a short commit', async () => {
        await expect(runInit(options({ sha: 'abc1234' })))
            .rejects.toThrow('--sha must be a full 40-character commit SHA');
    });

    it('uses the bundled workflow commit when no override is supplied', async () => {
        await runInit(options({ sha: undefined }));

        expect(workflowRef(generated(), STAGE_WORKFLOW)).toBe(SALLYPORT_WORKFLOW_SHA);
        expect(workflowRef(generated(), FINALIZE_WORKFLOW)).toBe(SALLYPORT_WORKFLOW_SHA);
    });

    it('refuses to overwrite an existing caller workflow', async () => {
        await runInit(options());

        await expect(runInit(options({ sha: OTHER_SHA })))
            .rejects.toThrow(/already exists; rerun with --upgrade/u);
        expect(workflowRef(generated(), STAGE_WORKFLOW)).toBe(FIXTURE_SHA);
    });

    it('prints the npm trust command and the setup checklist', async () => {
        await runInit(options({ strict: true }));

        const printed = logs.join('\n');
        expect(printed).toContain('npm trust github sallyport-fixture \\');
        expect(printed).toContain('--repository zsumz/fake \\');
        expect(printed).toContain('--file sallyport.yml \\');
        expect(printed).toContain('--environment npm-stage \\');
        expect(printed).toContain('--allow-stage-publish');
        expect(printed).toContain('npm-stage environment');
        expect(printed).toContain('github-release environment');
        expect(printed).toContain('SALLYPORT_SIGNER_FINGERPRINT');
        expect(printed).toContain('docs/releases/v1.2.3.md');
    });

    it('omits the fingerprint checklist line for the standard profile', async () => {
        await runInit(options());

        expect(logs.join('\n')).not.toContain('SALLYPORT_SIGNER_FINGERPRINT');
    });

    it('warns without failing when the release scripts are missing', async () => {
        const bare = createConsumer(makeTempRoot('init-scripts'), { scripts: {} });

        const status = await runInit(options({ dir: bare.dir }));

        expect(status).toBe(1);
        expect(logs.join('\n')).toContain('package.json defines no release:check script');
        expect(logs.join('\n')).toContain('package.json defines no release:smoke script');
        expect(existsSync(path.join(bare.dir, CALLER_WORKFLOW_FILE))).toBe(true);
        removeTempRoot(path.dirname(bare.dir));
    });

    it('fails when the package is private', async () => {
        const privateRoot = makeTempRoot('init-private');
        const bare = createConsumer(privateRoot);
        writeFileSync(
            path.join(bare.dir, 'package.json'),
            JSON.stringify({ name: 'x', version: '1.0.0', private: true }, null, 2),
        );

        await expect(runInit(options({ dir: bare.dir })))
            .rejects.toThrow('sallyport releases public packages only');
        removeTempRoot(privateRoot);
    });

    it('fails when the git remote is not a github repository', async () => {
        const otherRoot = makeTempRoot('init-remote');
        const bare = createConsumer(otherRoot, { remote: 'git@gitlab.com:zsumz/fake.git' });

        await expect(runInit(options({ dir: bare.dir })))
            .rejects.toThrow(/must identify a github.com repository/u);
        removeTempRoot(otherRoot);
    });

    it('accepts a GitHub SSH host alias', async () => {
        const aliasRoot = makeTempRoot('init-remote-alias');
        const bare = createConsumer(aliasRoot, {
            remote: 'git@github-zsumz:zsumz/fake.git',
        });

        expect(await runInit(options({ dir: bare.dir }))).toBe(0);
        removeTempRoot(aliasRoot);
    });
});

describe('runInit --upgrade', () => {
    it('rewrites both pins to the same new commit', async () => {
        writeTextFile(path.join(consumer.dir, SIGNING_KEY_FILE), 'PUBLIC KEY\n');
        await runInit(options({ strict: true }));

        const status = await runInit(options({ upgrade: true, sha: OTHER_SHA }));

        const content = generated();
        expect(status).toBe(0);
        expect(workflowRef(content, STAGE_WORKFLOW)).toBe(OTHER_SHA);
        expect(workflowRef(content, FINALIZE_WORKFLOW)).toBe(OTHER_SHA);
        expect(content).toContain('profile: strict');
        expect(content.split('\n').filter((line) => line === SIGNER_FINGERPRINT_LINE))
            .toHaveLength(2);
    });

    it('changes nothing else in the file', async () => {
        await runInit(options());
        const before = generated();

        await runInit(options({ upgrade: true, sha: OTHER_SHA }));

        expect(generated()).toBe(before.replaceAll(FIXTURE_SHA, OTHER_SHA));
    });

    it('refuses a caller workflow without the generated-by marker', async () => {
        await runInit(options());
        const content = generated();
        writeFileSync(workflowFile(), content.replace(GENERATED_MARKER, '# hand written'));

        await expect(runInit(options({ upgrade: true, sha: OTHER_SHA })))
            .rejects.toThrow(/generated-by marker; rerun with --force/u);
        expect(workflowRef(generated(), STAGE_WORKFLOW)).toBe(FIXTURE_SHA);
    });

    it('upgrades a hand-edited caller workflow with --force', async () => {
        await runInit(options());
        writeFileSync(workflowFile(), generated().replace(GENERATED_MARKER, '# hand written'));

        const status = await runInit(options({ upgrade: true, force: true, sha: OTHER_SHA }));

        expect(status).toBe(1);
        expect(workflowRef(generated(), STAGE_WORKFLOW)).toBe(OTHER_SHA);
        expect(workflowRef(generated(), FINALIZE_WORKFLOW)).toBe(OTHER_SHA);
    });

    it('refuses to upgrade a workflow that does not exist', async () => {
        await expect(runInit(options({ upgrade: true })))
            .rejects.toThrow(/does not exist; run npx sallyport init/u);
    });

    it('refuses to upgrade a workflow that does not pin both reusable workflows', async () => {
        await runInit(options());
        writeFileSync(
            workflowFile(),
            generated().replace(`${FINALIZE_WORKFLOW}@${FIXTURE_SHA}`, 'actions/checkout@v4'),
        );

        await expect(runInit(options({ upgrade: true, sha: OTHER_SHA })))
            .rejects.toThrow(/found 1 sallyport workflow references/u);
    });
});
