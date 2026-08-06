import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowDirectory = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));

interface Step {
    readonly uses?: string;
    readonly run?: string;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly needs?: string | readonly string[];
    readonly outputs?: Readonly<Record<string, string>>;
    readonly steps?: readonly Step[];
}

interface Workflow {
    readonly jobs?: Readonly<Record<string, Job>>;
}

function workflow(file: string): Workflow {
    return parse(readFileSync(`${workflowDirectory}${file}`, 'utf8')) as Workflow;
}

function job(file: string, name: string): Job {
    const value = workflow(file).jobs?.[name];
    if (value === undefined) throw new Error(`${file} has no ${name} job.`);
    return value;
}

function scripts(file: string, name: string): string {
    return (job(file, name).steps ?? []).map((step) => step.run ?? '').join('\n');
}

function action(file: string, name: string, actionName: string): Step {
    const step = (job(file, name).steps ?? [])
        .find((candidate) => (candidate.uses ?? '').includes(actionName));
    if (step === undefined) throw new Error(`${file}:${name} does not use ${actionName}.`);
    return step;
}

function stepIndex(file: string, name: string, matches: (step: Step) => boolean): number {
    return (job(file, name).steps ?? []).findIndex(matches);
}

describe('adversarial release model', () => {
    it('a malicious postinstall can emit bytes but cannot author the candidate receipt', () => {
        const prepare = scripts('stage.yml', 'prepare');
        const seal = scripts('stage.yml', 'seal');
        expect(prepare).toContain('npm ci');
        expect(prepare).not.toContain('internal create-candidate');
        expect(action('stage.yml', 'prepare', 'actions/upload-artifact').with?.path)
            .toBe('${{ runner.temp }}/sallyport-out/package.tgz');
        expect(seal).toContain('internal create-candidate');
        expect(seal).not.toMatch(/\bnpm\s+(?:ci|run)\b/u);
    });

    it('a forged candidate file or dist-tag is rejected against trusted context', () => {
        const stage = scripts('stage.yml', 'stage');
        expect(action('stage.yml', 'stage', 'actions/download-artifact').with?.['artifact-ids'])
            .toBe('${{ needs.seal.outputs.candidate_artifact_id }}');
        for (const binding of [
            'repository.name must match the current repository',
            'repository.id must match the current repository ID',
            'source.tag must match the triggering tag',
            'source.commit must match the triggering commit',
            'run.id must match the current workflow run',
            'run.attempt must match the current workflow attempt',
            'sallyport.sha must match the executing workflow commit',
            'package.distTag must be derived from package.version',
        ]) {
            expect(stage).toContain(binding);
        }
    });

    it('only sealed candidate bytes can satisfy the smoke required by staging', () => {
        const smoke = job('stage.yml', 'candidate_smoke');
        const stage = job('stage.yml', 'stage');
        expect(smoke.needs).toBe('seal');
        expect(action('stage.yml', 'candidate_smoke', 'actions/download-artifact')
            .with?.['artifact-ids'])
            .toBe('${{ needs.seal.outputs.candidate_artifact_id }}');
        expect(scripts('stage.yml', 'candidate_smoke')).toContain('internal smoke');
        const install = stepIndex('stage.yml', 'candidate_smoke', (step) => step.run === 'npm ci');
        const checkout = stepIndex(
            'stage.yml',
            'candidate_smoke',
            (step) => step.with?.repository === 'zsumz/sallyport',
        );
        const download = stepIndex(
            'stage.yml',
            'candidate_smoke',
            (step) => (step.uses ?? '').includes('actions/download-artifact'),
        );
        expect(install).toBeGreaterThan(-1);
        expect(checkout).toBeGreaterThan(install);
        expect(download).toBeGreaterThan(checkout);
        const smokeScripts = scripts('stage.yml', 'candidate_smoke');
        expect(smokeScripts).toContain('createHash(\'sha256\')');
        expect(smokeScripts).toContain('sealed package.tgz does not match candidate.json');
        expect((smoke.steps ?? []).some((step) => (step.uses ?? '').includes('upload-artifact')))
            .toBe(false);
        expect(smoke.outputs).toBeUndefined();
        expect(stage.needs).toEqual(['seal', 'candidate_smoke']);
    });

    it('consumer smoke cannot replace the clean finalizer bundle', () => {
        const core = job('finalize.yml', 'verify_core');
        const smoke = job('finalize.yml', 'public_smoke');
        const releaseJob = job('finalize.yml', 'release');
        expect(core.outputs?.bundle_artifact_id).toContain('artifact-id');
        expect((smoke.steps ?? []).some((step) => (step.uses ?? '').includes('upload-artifact')))
            .toBe(false);
        expect(smoke.outputs).toBeUndefined();
        expect(releaseJob.needs).toEqual(['verify_core', 'public_smoke']);
        const install = stepIndex('finalize.yml', 'public_smoke', (step) => step.run === 'npm ci');
        const download = stepIndex(
            'finalize.yml',
            'public_smoke',
            (step) => (step.uses ?? '').includes('actions/download-artifact'),
        );
        expect(download).toBeGreaterThan(install);
        const smokeScripts = scripts('finalize.yml', 'public_smoke');
        expect(smokeScripts).toContain('smoke copy after smoke');
        expect(smokeScripts).toContain('authoritative package.tgz after smoke');
        expect(action('finalize.yml', 'release', 'actions/download-artifact').with?.['artifact-ids'])
            .toBe('${{ needs.verify_core.outputs.bundle_artifact_id }}');
        const release = scripts('finalize.yml', 'release');
        expect(release).toContain('sallyport-candidate-${commit}-${String(attempt)}');
        expect(release).toContain('bundled candidate.json must equal the originating sealed receipt');
        expect(release).toContain('bundled package.tgz must equal the originating sealed tarball');
    });

    it('moved tags fail at stage, finalize, and immediately before a release write', () => {
        for (const file of ['stage.yml', 'finalize.yml']) {
            const source = readFileSync(`${workflowDirectory}${file}`, 'utf8');
            expect(source).toContain('refs/tags/$SALLYPORT_TAG:refs/tags/$SALLYPORT_TAG');
            expect(source).toContain('--expected-commit "$SALLYPORT_COMMIT"');
        }
        const release = scripts('finalize.yml', 'release');
        expect(release).toContain('assertTagTarget();');
        expect(release).toContain('object?.sha !== tagObject');
        expect(release).toContain('no longer references verified object');
        expect(release).toContain('object.sha !== commit');
        expect(release).toMatch(/assertTagTarget\(\);\s+const paths =/u);
        expect(release).toMatch(
            /assertTagTarget\(\);\s+const result = gh\(\['release', 'edit'/u,
        );
    });

    it('replay authenticates release notes and presentation metadata', () => {
        const release = scripts('finalize.yml', 'release');
        expect(release).toContain('\'RELEASE_NOTES.md\'');
        expect(release).toContain('release.releaseNotesSha256');
        expect(release).toContain('release.name !== title');
        expect(release).toContain('release.body !== notes');
        expect(release).not.toContain('\'--clobber\'');
    });
});
