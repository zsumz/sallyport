import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowDirectory = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));

interface WorkflowInput {
    readonly description?: string;
    readonly required?: boolean;
    readonly type?: string;
    readonly default?: string;
}

interface WorkflowTriggers {
    readonly workflow_call?: {
        readonly inputs?: Readonly<Record<string, WorkflowInput>>;
        readonly secrets?: unknown;
    };
    readonly push?: unknown;
    readonly pull_request?: unknown;
    readonly workflow_dispatch?: unknown;
}

interface WorkflowStep {
    readonly uses?: string;
    readonly run?: string;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface WorkflowJob {
    readonly 'runs-on'?: string;
    readonly needs?: string | string[];
    readonly steps?: readonly WorkflowStep[];
}

interface WorkflowFile {
    readonly on?: WorkflowTriggers;
    readonly permissions?: Readonly<Record<string, string>>;
    readonly concurrency?: { readonly group?: string; readonly 'cancel-in-progress'?: string };
    readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

// The caller template owns release serialization; a reusable workflow that
// declared the same group would deadlock against its own caller.
const CALLER_CONCURRENCY_GROUP = 'sallyport-${{ github.repository }}';

const EXPECTED_INPUTS: ReadonlyArray<readonly [string, Readonly<Record<string, WorkflowInput>>]> = [
    [
        'stage.yml',
        {
            profile: { required: false, type: 'string', default: 'standard' },
            signer_fingerprint: { required: false, type: 'string', default: '' },
        },
    ],
    [
        'finalize.yml',
        {
            candidate_run_id: { required: true, type: 'string' },
            profile: { required: false, type: 'string', default: 'standard' },
            signer_fingerprint: { required: false, type: 'string', default: '' },
        },
    ],
];

const EXPECTED_JOB_GRAPH: ReadonlyArray<readonly [
    string,
    readonly string[],
    Readonly<Record<string, string | readonly string[]>>,
]> = [
    [
        'stage.yml',
        ['prepare', 'seal', 'candidate_smoke', 'stage'],
        {
            seal: 'prepare',
            candidate_smoke: 'seal',
            stage: ['seal', 'candidate_smoke'],
        },
    ],
    [
        'finalize.yml',
        ['verify_core', 'public_smoke', 'release'],
        { public_smoke: 'verify_core', release: ['verify_core', 'public_smoke'] },
    ],
];

function readWorkflow(file: string): WorkflowFile {
    return parse(readFileSync(`${workflowDirectory}${file}`, 'utf8')) as WorkflowFile;
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function stepsOf(workflow: WorkflowFile, name: string): readonly WorkflowStep[] {
    return workflow.jobs?.[name]?.steps ?? [];
}

function allSteps(workflow: WorkflowFile): WorkflowStep[] {
    return Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

describe('reusable workflow contract', () => {
    for (const [file, inputs] of EXPECTED_INPUTS) {
        it(`${file} exposes exactly the designed workflow_call inputs`, () => {
            const declared = readWorkflow(file).on?.workflow_call?.inputs ?? {};
            expect(Object.keys(declared).sort()).toEqual(Object.keys(inputs).sort());
            for (const [name, expected] of Object.entries(inputs)) {
                const actual = declared[name];
                expect(actual?.type).toBe(expected.type);
                expect(actual?.required ?? false).toBe(expected.required);
                expect(actual?.default).toBe(expected.default);
                expect(typeof actual?.description).toBe('string');
            }
        });

        it(`${file} declares no callable secrets`, () => {
            expect(readWorkflow(file).on?.workflow_call?.secrets).toBeUndefined();
        });

        it(`${file} grants no default permissions`, () => {
            expect(readWorkflow(file).permissions).toEqual({});
        });

        it(`${file} leaves release serialization to the caller`, () => {
            expect(readWorkflow(file).concurrency).toBeUndefined();
        });

        it(`${file} pins the qualified Node toolchain everywhere`, () => {
            const workflow = readWorkflow(file);
            const setupSteps = allSteps(workflow).filter(
                (step) => (step.uses ?? '').includes('actions/setup-node'),
            );
            expect(setupSteps.length).toBeGreaterThan(0);
            for (const step of setupSteps) {
                expect(step.with?.['node-version']).toBe('24.19.0');
            }
            const assertions = allSteps(workflow)
                .map((step) => step.run ?? '')
                .filter((run) => run.includes('node --version'));
            expect(assertions.length).toBe(setupSteps.length);
            for (const assertion of assertions) {
                expect(assertion).toContain('v24.19.0');
                expect(assertion).toContain('11.17.0');
            }
        });
    }

    for (const [file, jobs, dependencies] of EXPECTED_JOB_GRAPH) {
        it(`${file} contains exactly the designed job graph`, () => {
            const workflow = readWorkflow(file);
            expect(Object.keys(workflow.jobs ?? {})).toEqual([...jobs]);
            for (const [job, dependency] of Object.entries(dependencies)) {
                expect(workflow.jobs?.[job]?.needs).toEqual(dependency);
            }
            for (const job of jobs) {
                expect(workflow.jobs?.[job]?.['runs-on']).toBe('ubuntu-24.04');
            }
        });
    }

    it('stage.yml seals exactly the candidate tarball and receipt on a fresh runner', () => {
        const workflow = readWorkflow('stage.yml');
        const unsealed = stepsOf(workflow, 'prepare').find(
            (step) => (step.uses ?? '').includes('actions/upload-artifact'),
        );
        expect(unsealed?.with?.path).toBe('${{ runner.temp }}/sallyport-out/package.tgz');
        expect(unsealed?.with?.['retention-days']).toBe(1);
        const upload = stepsOf(workflow, 'seal').find(
            (step) => (step.uses ?? '').includes('actions/upload-artifact'),
        );
        expect(upload?.with?.name)
            .toBe('sallyport-candidate-${{ github.sha }}-${{ github.run_attempt }}');
        expect(upload?.with?.['retention-days']).toBe(90);
        expect(upload?.with?.['if-no-files-found']).toBe('error');
        const paths = text(upload?.with?.path).trim().split('\n').map((line) => line.trim());
        expect(paths).toEqual([
            '${{ runner.temp }}/sallyport-out/package.tgz',
            '${{ runner.temp }}/sallyport-out/candidate.json',
        ]);
    });

    it('finalize.yml hands the verified bundle to the release job by artifact', () => {
        const upload = stepsOf(readWorkflow('finalize.yml'), 'verify_core').find(
            (step) => (step.uses ?? '').includes('actions/upload-artifact'),
        );
        const download = stepsOf(readWorkflow('finalize.yml'), 'release').find(
            (step) => (step.uses ?? '').includes('actions/download-artifact'),
        );
        expect(upload?.with?.name).toBe('sallyport-release-${{ inputs.candidate_run_id }}');
        expect(upload?.with?.['retention-days']).toBe(90);
        expect(upload?.with?.['if-no-files-found']).toBe('error');
        expect(download?.with?.['artifact-ids'])
            .toBe('${{ needs.verify_core.outputs.bundle_artifact_id }}');
    });

    it('stage.yml derives every release value from the tag rather than an input', () => {
        const workflow = readWorkflow('stage.yml');
        const scripts = [
            ...stepsOf(workflow, 'prepare'),
            ...stepsOf(workflow, 'seal'),
            ...stepsOf(workflow, 'candidate_smoke'),
        ]
            .map((step) => step.run ?? '')
            .join('\n');
        expect(scripts).toContain('internal inspect-source');
        expect(scripts).toContain('internal pack');
        expect(scripts).toContain('internal smoke');
        expect(scripts).toContain('internal create-candidate');
        expect(scripts).toContain('npm run release:check');
    });

    it('finalize.yml reverifies the source and the public bytes before writing', () => {
        const scripts = stepsOf(readWorkflow('finalize.yml'), 'verify_core')
            .map((step) => step.run ?? '')
            .join('\n');
        expect(scripts).toContain('internal fetch-candidate');
        expect(scripts).toContain('internal inspect-source');
        expect(scripts).toContain('internal verify-public');
        expect(scripts).toContain('internal create-release-bundle');
        expect(scripts).toContain('--skip-smoke');
    });

    it('passes artifacts across every trust boundary by immutable ID', () => {
        const stage = readWorkflow('stage.yml');
        const finalize = readWorkflow('finalize.yml');
        const downloads = [
            ...stepsOf(stage, 'seal'),
            ...stepsOf(stage, 'candidate_smoke'),
            ...stepsOf(stage, 'stage'),
            ...stepsOf(finalize, 'public_smoke'),
            ...stepsOf(finalize, 'release'),
        ].filter((step) => (step.uses ?? '').includes('actions/download-artifact'));
        expect(downloads).toHaveLength(6);
        for (const download of downloads) {
            expect(download.with?.['artifact-ids']).toMatch(/^\$\{\{ (?:needs|steps)\./u);
            expect(download.with?.name).toBeUndefined();
        }
    });

    it('binds detached checkouts to a private default-branch ref and exact commit', () => {
        for (const file of ['stage.yml', 'finalize.yml'] as const) {
            const source = readFileSync(`${workflowDirectory}${file}`, 'utf8');
            expect(source).toContain('refs/sallyport/default-branch');
            expect(source).toContain('--default-branch-ref refs/sallyport/default-branch');
            expect(source).toContain('--expected-commit "$SALLYPORT_COMMIT"');
            expect(source).not.toContain('refs/remotes/origin/$SALLYPORT_DEFAULT_BRANCH');
        }
    });

    it('finalize.yml publishes drafts first and never force-replaces a release', () => {
        const scripts = stepsOf(readWorkflow('finalize.yml'), 'release')
            .map((step) => step.run ?? '')
            .join('\n');
        expect(scripts).toMatch(/'release', 'create', tag,/);
        expect(scripts).toMatch(/'--draft',/);
        expect(scripts).toMatch(/'--verify-tag',/);
        expect(scripts).toMatch(/'--draft=false'/);
        expect(scripts).toContain('args.push(\'--prerelease\')');
        expect(scripts)
            .toContain('prerelease: prerelease === undefined ? \'false\' : \'true\'');
        expect(scripts).toContain('release.prerelease !== prerelease');
        expect(scripts).toContain('execFileSync');
        expect(scripts).not.toMatch(/\bgh\s+release\b/);
    });
});

describe('continuous integration workflow', () => {
    it('reads repository contents only', () => {
        expect(readWorkflow('ci.yml').permissions).toEqual({ contents: 'read' });
    });

    it('serializes on a group distinct from the release groups', () => {
        const concurrency = readWorkflow('ci.yml').concurrency;
        const group = concurrency?.group ?? '';
        expect(group.startsWith('ci-')).toBe(true);
        expect(group).not.toBe(CALLER_CONCURRENCY_GROUP);
        expect(group).not.toContain('sallyport');
        expect(concurrency?.['cancel-in-progress']).toMatch(
            /^\$\{\{ github\.event_name == 'pull_request' \}\}$/,
        );
    });

    it('validates workflows, supported Node versions, and coverage', () => {
        const workflow = readWorkflow('ci.yml');
        expect(Object.keys(workflow.jobs ?? {})).toEqual(['workflows', 'validate', 'coverage']);
        const scripts = allSteps(workflow).map((step) => step.run ?? '').join('\n');
        expect(scripts).toContain('ACTIONLINT_SHA256');
        expect(scripts).toContain('sha256sum --check');
        expect(scripts).toContain('"$RUNNER_TEMP/actionlint"');
        expect(scripts).toContain('npm run validate');
        expect(scripts).toContain('npm run coverage:check');
        const versions = allSteps(workflow)
            .filter((step) => (step.uses ?? '').includes('actions/setup-node'))
            .map((step) => text(step.with?.['node-version']));
        expect(versions).toContain('${{ matrix.node-version }}');
        expect(versions).toContain('24.19.0');
        const source = readFileSync(`${workflowDirectory}ci.yml`, 'utf8');
        for (const version of ['22.18.0', '24.19.0', '26.x']) {
            expect(source).toContain(`node-version: ${version}`);
        }
    });

    it('checks out complete history anywhere the protocol pin can run', () => {
        const workflow = readWorkflow('ci.yml');
        for (const job of Object.values(workflow.jobs ?? {})) {
            const checkout = (job.steps ?? []).find(
                (step) => (step.uses ?? '').includes('actions/checkout'),
            );
            expect(checkout?.with?.['fetch-depth']).toBe(0);
        }
    });
});
