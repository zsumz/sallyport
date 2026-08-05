import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowDirectory = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));

interface WorkflowStep {
    readonly name?: string;
    readonly uses?: string;
    readonly run?: string;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface WorkflowJob {
    readonly 'runs-on'?: string;
    readonly 'timeout-minutes'?: number;
    readonly environment?: string;
    readonly needs?: string | string[];
    readonly permissions?: Readonly<Record<string, string>>;
    readonly steps?: readonly WorkflowStep[];
}

interface WorkflowFile {
    readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

interface JobBoundary {
    readonly workflow: string;
    readonly job: string;
    readonly permissions: Readonly<Record<string, string>>;
    readonly environment: string | undefined;
    readonly runsConsumerCode: boolean;
}

// Jobs that hold a credential must never contain repository code; jobs that
// contain repository code must never hold a credential.
const JOB_BOUNDARIES: readonly JobBoundary[] = [
    {
        workflow: 'stage.yml',
        job: 'prepare',
        permissions: { contents: 'read' },
        environment: undefined,
        runsConsumerCode: true,
    },
    {
        workflow: 'stage.yml',
        job: 'seal',
        permissions: { actions: 'read', contents: 'read' },
        environment: undefined,
        runsConsumerCode: true,
    },
    {
        workflow: 'stage.yml',
        job: 'stage',
        permissions: { 'id-token': 'write' },
        environment: 'npm-stage',
        runsConsumerCode: false,
    },
    {
        workflow: 'finalize.yml',
        job: 'verify_core',
        permissions: { actions: 'read', contents: 'read' },
        environment: undefined,
        runsConsumerCode: true,
    },
    {
        workflow: 'finalize.yml',
        job: 'public_smoke',
        permissions: { actions: 'read', contents: 'read' },
        environment: undefined,
        runsConsumerCode: true,
    },
    {
        workflow: 'finalize.yml',
        job: 'release',
        permissions: { actions: 'read', contents: 'write' },
        environment: 'github-release',
        runsConsumerCode: false,
    },
];

// Anything on this list would let repository code reach a credentialed job.
const FORBIDDEN_IN_CREDENTIALED_JOBS: Array<[string, RegExp]> = [
    ['an npm install', /\bnpm\s+ci\b/],
    ['an npm script', /\bnpm\s+run\b/],
    ['a direct npm publish', /\bnpm\s+publish\b/],
    ['a checked-out workspace', /GITHUB_WORKSPACE/],
    ['a git checkout', /\bgit\s+(?:clone|fetch|checkout)\b/],
    ['a secret reference', /secrets\./],
];

function readWorkflow(file: string): WorkflowFile {
    return parse(readFileSync(`${workflowDirectory}${file}`, 'utf8')) as WorkflowFile;
}

function jobOf(file: string, name: string): WorkflowJob {
    const job = readWorkflow(file).jobs?.[name];
    if (job === undefined) {
        throw new Error(`Workflow ${file} has no job named ${name}.`);
    }
    return job;
}

function stepsOf(job: WorkflowJob): readonly WorkflowStep[] {
    return job.steps ?? [];
}

function runScriptsOf(job: WorkflowJob): string {
    return stepsOf(job).map((step) => step.run ?? '').join('\n');
}

function usesOf(job: WorkflowJob): string[] {
    return stepsOf(job).map((step) => step.uses ?? '').filter((uses) => uses !== '');
}

describe('reusable workflow privilege boundaries', () => {
    for (const boundary of JOB_BOUNDARIES) {
        const label = `${boundary.workflow}:${boundary.job}`;

        it(`${label} declares exactly its designed permissions`, () => {
            expect(jobOf(boundary.workflow, boundary.job).permissions).toEqual(boundary.permissions);
        });

        it(`${label} declares its designed environment`, () => {
            expect(jobOf(boundary.workflow, boundary.job).environment).toBe(boundary.environment);
        });

        it(`${label} pins the runner and a timeout`, () => {
            const job = jobOf(boundary.workflow, boundary.job);
            expect(job['runs-on']).toBe('ubuntu-24.04');
            expect(typeof job['timeout-minutes']).toBe('number');
        });

        it(`${label} uses no local actions`, () => {
            for (const uses of usesOf(jobOf(boundary.workflow, boundary.job))) {
                expect(uses.startsWith('./')).toBe(false);
                expect(uses.startsWith('../')).toBe(false);
            }
        });

        if (!boundary.runsConsumerCode) {
            it(`${label} never checks out a repository`, () => {
                for (const uses of usesOf(jobOf(boundary.workflow, boundary.job))) {
                    expect(uses).not.toContain('actions/checkout');
                }
            });

            for (const [description, pattern] of FORBIDDEN_IN_CREDENTIALED_JOBS) {
                it(`${label} contains no ${description}`, () => {
                    expect(runScriptsOf(jobOf(boundary.workflow, boundary.job))).not.toMatch(pattern);
                });
            }

            it(`${label} restores no package-manager cache`, () => {
                for (const step of stepsOf(jobOf(boundary.workflow, boundary.job))) {
                    if (!(step.uses ?? '').includes('actions/setup-node')) {
                        continue;
                    }
                    expect(step.with?.cache).toBeUndefined();
                    expect(step.with?.['package-manager-cache']).toBe(false);
                }
            });

            it(`${label} references no secrets anywhere in the job`, () => {
                expect(JSON.stringify(jobOf(boundary.workflow, boundary.job))).not.toContain('secrets');
            });
        }
    }

    it('stage.yml:stage holds no permission other than id-token: write', () => {
        const permissions = jobOf('stage.yml', 'stage').permissions ?? {};
        expect(Object.keys(permissions)).toEqual(['id-token']);
        expect(permissions.contents).toBeUndefined();
    });

    it('finalize.yml:release holds no OIDC or npm authority', () => {
        const permissions = jobOf('finalize.yml', 'release').permissions ?? {};
        expect(Object.keys(permissions)).toEqual(['actions', 'contents']);
        expect(permissions['id-token']).toBeUndefined();
        expect(runScriptsOf(jobOf('finalize.yml', 'release'))).not.toMatch(/\bnpm\s+stage\b/);
    });

    it('stage.yml:stage stages exactly one validated tarball', () => {
        const scripts = runScriptsOf(jobOf('stage.yml', 'stage'));
        expect(scripts).toContain('npm stage publish');
        expect(scripts).toContain('--ignore-scripts');
        expect(scripts).toContain('--provenance');
        expect(scripts).toContain('--access public');
        expect(scripts).toContain('--tag "$SALLYPORT_DIST_TAG"');
    });

    it('credentialed jobs validate their inputs with embedded dependency-free node', () => {
        for (const [file, job] of [['stage.yml', 'stage'], ['finalize.yml', 'release']] as const) {
            const scripts = runScriptsOf(jobOf(file, job));
            expect(scripts).toContain('node --input-type=module -');
            expect(scripts).toMatch(/import \{ createHash \} from 'node:crypto';/);
            expect(scripts).not.toMatch(/import\s+.*\s+from\s+'(?!node:)/);
        }
    });

    it('only unprivileged jobs check out sallyport implementation code', () => {
        for (const [file, job] of [
            ['stage.yml', 'prepare'],
            ['stage.yml', 'seal'],
            ['finalize.yml', 'verify_core'],
        ] as const) {
            const sallyportCheckout = stepsOf(jobOf(file, job)).find(
                (step) => step.with?.repository === 'zsumz/sallyport',
            );
            expect(sallyportCheckout).toBeDefined();
            expect(sallyportCheckout?.with?.ref).toBe('${{ job.workflow_sha }}');
            expect(sallyportCheckout?.with?.['persist-credentials']).toBe(false);
        }
    });

    it('never uses the nonexistent github.job_workflow_sha property', () => {
        for (const file of ['stage.yml', 'finalize.yml'] as const) {
            expect(readFileSync(`${workflowDirectory}${file}`, 'utf8'))
                .not.toContain('github.job_workflow_sha');
        }
    });

    it('consumer checkouts never persist credentials', () => {
        for (const [file, job] of [
            ['stage.yml', 'prepare'],
            ['stage.yml', 'seal'],
            ['finalize.yml', 'verify_core'],
            ['finalize.yml', 'public_smoke'],
        ] as const) {
            for (const step of stepsOf(jobOf(file, job))) {
                if (!(step.uses ?? '').includes('actions/checkout')) {
                    continue;
                }
                expect(step.with?.['persist-credentials']).toBe(false);
            }
        }
    });

    it('fresh sealing jobs execute no consumer dependency or package code', () => {
        for (const [file, job] of [
            ['stage.yml', 'seal'],
            ['finalize.yml', 'verify_core'],
        ] as const) {
            const scripts = runScriptsOf(jobOf(file, job));
            expect(scripts).not.toMatch(/\bnpm\s+ci\b/);
            expect(scripts).not.toMatch(/\bnpm\s+run\b/);
            expect(scripts).not.toContain('internal smoke');
            expect(scripts).not.toContain('release:smoke');
        }
    });

    it('consumer smoke exports no artifact or job output trusted by release', () => {
        const smoke = jobOf('finalize.yml', 'public_smoke');
        expect(smoke.needs).toBe('verify_core');
        expect(usesOf(smoke).some((uses) => uses.includes('actions/upload-artifact'))).toBe(false);
        expect(JSON.stringify(smoke)).not.toContain('GITHUB_OUTPUT');
        expect(jobOf('finalize.yml', 'release').needs).toEqual(['verify_core', 'public_smoke']);
    });
});
