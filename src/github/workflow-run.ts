import type { CandidateReceipt } from '../candidate/receipt.ts';
import {
    readNumberProperty,
    readProperty,
    readStringProperty,
} from '../registry/download.ts';

export const CALLER_WORKFLOW_PATH = '.github/workflows/sallyport.yml';

export interface CandidateRunExpectation {
    repositoryId: number;
    workflowPath: string;
    sallyportSha: string;
    receipt: CandidateReceipt;
}

export interface CandidateRunInput {
    run: unknown;
    expected: CandidateRunExpectation;
}

// Design §11 Step A. Pure checks over the injected GitHub API run object.
// Anything that cannot be read is a failure: the finalizer fails closed.
export function validateCandidateRun(input: CandidateRunInput): string[] {
    const { run, expected } = input;
    const { receipt } = expected;
    if (typeof run !== 'object' || run === null) {
        return ['Workflow run response was not an object.'];
    }
    const failures: string[] = [];

    const runId = readNumberProperty(run, 'id');
    if (runId === null) {
        failures.push('Workflow run has no numeric id.');
    } else if (runId !== receipt.run.id) {
        failures.push(`Workflow run ${String(runId)} does not match candidate run ${String(receipt.run.id)}.`);
    }

    const repository = readProperty(run, 'repository');
    const repositoryId = readNumberProperty(repository, 'id');
    if (repositoryId === null) {
        failures.push('Workflow run has no repository id.');
    } else if (repositoryId !== expected.repositoryId) {
        failures.push(
            `Workflow run repository ${String(repositoryId)} does not match ${String(expected.repositoryId)}.`,
        );
    }
    if (receipt.repository.id !== expected.repositoryId) {
        failures.push(
            `Candidate repository ${String(receipt.repository.id)} does not match ${String(expected.repositoryId)}.`,
        );
    }
    const repositoryName = readStringProperty(repository, 'full_name');
    if (repositoryName === null) {
        failures.push('Workflow run has no repository name.');
    } else if (repositoryName !== receipt.repository.name) {
        failures.push(
            `Workflow run repository ${repositoryName} does not match candidate ${receipt.repository.name}.`,
        );
    }

    const path = readStringProperty(run, 'path');
    if (path === null) {
        failures.push('Workflow run has no workflow path.');
    } else if (path !== expected.workflowPath) {
        failures.push(
            `Workflow run used ${path}, expected ${expected.workflowPath}.`,
        );
    }

    const event = readStringProperty(run, 'event');
    if (event !== 'push') {
        failures.push(`Workflow run event ${event ?? 'unknown'} is not a tag push.`);
    }

    const conclusion = readStringProperty(run, 'conclusion');
    if (conclusion !== 'success') {
        failures.push(`Workflow run concluded ${conclusion ?? 'unknown'}, expected success.`);
    }

    if (receipt.sallyport.sha !== expected.sallyportSha) {
        failures.push(
            `Candidate sallyport SHA ${receipt.sallyport.sha} does not match the pinned finalizer ${expected.sallyportSha}.`,
        );
    }

    const runAttempt = readNumberProperty(run, 'run_attempt');
    if (runAttempt === null) {
        failures.push('Workflow run has no numeric attempt.');
    } else if (runAttempt !== receipt.run.attempt) {
        failures.push(
            `Workflow run attempt ${String(runAttempt)}`
            + ` does not match candidate attempt ${String(receipt.run.attempt)}.`,
        );
    }

    const headBranch = readStringProperty(run, 'head_branch');
    if (headBranch === null) {
        failures.push('Workflow run has no head branch.');
    } else if (headBranch !== receipt.source.tag) {
        failures.push(
            `Workflow run tag ${headBranch} does not match candidate tag ${receipt.source.tag}.`,
        );
    }

    const headSha = readStringProperty(run, 'head_sha');
    if (headSha === null) {
        failures.push('Workflow run has no head commit.');
    } else if (headSha !== receipt.source.commit) {
        failures.push(
            `Workflow run commit ${headSha} does not match candidate commit ${receipt.source.commit}.`,
        );
    }

    return failures;
}
