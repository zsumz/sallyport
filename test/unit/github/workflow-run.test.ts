import { describe, expect, it } from 'vitest';
import type { CandidateReceipt } from '../../../src/candidate/receipt.ts';
import {
    CALLER_WORKFLOW_PATH,
    validateCandidateRun,
    type CandidateRunExpectation,
} from '../../../src/github/workflow-run.ts';

const SALLYPORT_SHA = 'a'.repeat(40);
const COMMIT = 'b'.repeat(40);
const REPOSITORY_ID = 1286348597;
const RUN_ID = 123456789;

function makeReceipt(): CandidateReceipt {
    return {
        schema: 1,
        protocol: 'sallyport/0.1',
        sallyport: {
            version: '0.1.0',
            workflow: 'zsumz/sallyport/.github/workflows/stage.yml',
            sha: SALLYPORT_SHA,
        },
        repository: { name: 'zsumz/demo', id: REPOSITORY_ID, defaultBranch: 'main' },
        source: {
            tag: 'v1.2.3',
            commit: COMMIT,
            signed: true,
            signerFingerprint: 'C'.repeat(40),
        },
        package: {
            name: 'demo',
            version: '1.2.3',
            access: 'public',
            distTag: 'latest',
        },
        tarball: {
            filename: 'package.tgz',
            bytes: 1024,
            sha256: '1'.repeat(64),
            sha512: '2'.repeat(128),
            integrity: 'sha512-Zm9v',
        },
        run: { id: RUN_ID, attempt: 1 },
    };
}

function makeRun(): Record<string, unknown> {
    return {
        id: RUN_ID,
        name: 'sallyport',
        path: CALLER_WORKFLOW_PATH,
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        head_branch: 'v1.2.3',
        head_sha: COMMIT,
        repository: { id: REPOSITORY_ID, full_name: 'zsumz/demo' },
    };
}

function makeExpected(): CandidateRunExpectation {
    return {
        repositoryId: REPOSITORY_ID,
        workflowPath: CALLER_WORKFLOW_PATH,
        sallyportSha: SALLYPORT_SHA,
        receipt: makeReceipt(),
    };
}

describe('validateCandidateRun', () => {
    it('accepts a successful tag-push run that produced the candidate', () => {
        expect(validateCandidateRun({ run: makeRun(), expected: makeExpected() }))
            .toStrictEqual([]);
    });

    it('pins the generated caller workflow filename', () => {
        expect(CALLER_WORKFLOW_PATH).toBe('.github/workflows/sallyport.yml');
    });

    it('rejects a non-object run response', () => {
        expect(validateCandidateRun({ run: null, expected: makeExpected() }))
            .toStrictEqual(['Workflow run response was not an object.']);
    });

    it('rejects a run from another repository', () => {
        const run = makeRun();
        run.repository = { id: 999, full_name: 'zsumz/demo' };
        const failures = validateCandidateRun({ run, expected: makeExpected() });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('Workflow run repository 999');
    });

    it('rejects a receipt from another repository', () => {
        const expected = makeExpected();
        expected.receipt.repository.id = 999;
        const failures = validateCandidateRun({ run: makeRun(), expected });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('Candidate repository 999');
    });

    it('rejects a repository name that disagrees with the receipt', () => {
        const run = makeRun();
        run.repository = { id: REPOSITORY_ID, full_name: 'attacker/demo' };
        const failures = validateCandidateRun({ run, expected: makeExpected() });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('attacker/demo');
    });

    it('rejects a run from another workflow file', () => {
        const run = makeRun();
        run.path = '.github/workflows/release.yml';
        const failures = validateCandidateRun({ run, expected: makeExpected() });
        expect(failures).toStrictEqual([
            'Workflow run used .github/workflows/release.yml, expected .github/workflows/sallyport.yml.',
        ]);
    });

    it('rejects a run that was not a push', () => {
        const run = makeRun();
        run.event = 'workflow_dispatch';
        expect(validateCandidateRun({ run, expected: makeExpected() }))
            .toStrictEqual(['Workflow run event workflow_dispatch is not a tag push.']);
    });

    it('rejects a run that did not conclude successfully', () => {
        const run = makeRun();
        run.conclusion = 'failure';
        expect(validateCandidateRun({ run, expected: makeExpected() }))
            .toStrictEqual(['Workflow run concluded failure, expected success.']);
    });

    it('rejects a run that is still in progress', () => {
        const run = makeRun();
        run.conclusion = null;
        expect(validateCandidateRun({ run, expected: makeExpected() }))
            .toStrictEqual(['Workflow run concluded unknown, expected success.']);
    });

    it('rejects a candidate built by another sallyport commit', () => {
        const expected = makeExpected();
        expected.sallyportSha = 'f'.repeat(40);
        const failures = validateCandidateRun({ run: makeRun(), expected });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('does not match the pinned finalizer');
    });

    it('rejects a run id that does not match the receipt', () => {
        const run = makeRun();
        run.id = 987654321;
        const failures = validateCandidateRun({ run, expected: makeExpected() });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toBe(
            'Workflow run 987654321 does not match candidate run 123456789.',
        );
    });

    it('rejects a run for another tag', () => {
        const run = makeRun();
        run.head_branch = 'v1.2.4';
        const failures = validateCandidateRun({ run, expected: makeExpected() });
        expect(failures).toStrictEqual([
            'Workflow run tag v1.2.4 does not match candidate tag v1.2.3.',
        ]);
    });

    it('rejects a run for another commit', () => {
        const run = makeRun();
        run.head_sha = 'c'.repeat(40);
        const failures = validateCandidateRun({ run, expected: makeExpected() });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('does not match candidate commit');
    });

    it('fails closed on every unreadable field', () => {
        const failures = validateCandidateRun({ run: {}, expected: makeExpected() });
        expect(failures).toStrictEqual([
            'Workflow run has no numeric id.',
            'Workflow run has no repository id.',
            'Workflow run has no repository name.',
            'Workflow run has no workflow path.',
            'Workflow run event unknown is not a tag push.',
            'Workflow run concluded unknown, expected success.',
            'Workflow run has no head branch.',
            'Workflow run has no head commit.',
        ]);
    });
});
