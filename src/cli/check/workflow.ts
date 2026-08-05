import { RELEASE_NOTES_DIRECTORY } from '../../contract/release.ts';
import {
    CALLER_WORKFLOW_FILE,
    FINALIZE_WORKFLOW,
    hasGeneratedMarker,
    STAGE_WORKFLOW,
    workflowRef,
} from '../template.ts';
import { result, SIGNING_KEY_FILE, type CheckContext, type CheckResult } from './model.ts';

const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

// Both artifacts are mandatory only under the strict profile; a standard
// consumer sees them as information, never as a failure.
export function releaseNotesCheck(context: CheckContext): CheckResult {
    const id = 'release-notes-directory';
    if (context.hasReleaseNotesDirectory) {
        return result(id, 'pass', `${RELEASE_NOTES_DIRECTORY}/ exists.`);
    }
    const message = `${RELEASE_NOTES_DIRECTORY}/ must exist and contain v<version>.md for the release being tagged.`;
    return result(id, context.profile === 'strict' ? 'fail' : 'skip', message);
}

export function signingKeyCheck(context: CheckContext): CheckResult {
    const id = 'signing-key';
    if (context.hasSigningKey) {
        return result(id, 'pass', `${SIGNING_KEY_FILE} exists.`);
    }
    const message = `${SIGNING_KEY_FILE} must contain the public release signing key.`;
    return result(id, context.profile === 'strict' ? 'fail' : 'skip', message);
}

export function callerWorkflowCheck(context: CheckContext): CheckResult {
    const id = 'caller-workflow';
    const { workflow } = context;
    if (workflow === null) {
        return result(
            id,
            'fail',
            `${CALLER_WORKFLOW_FILE} is missing; generate it with npx sallyport init.`,
        );
    }
    if (!hasGeneratedMarker(workflow)) {
        return result(
            id,
            'fail',
            `${CALLER_WORKFLOW_FILE} was hand-edited; its first line must be the sallyport generated-by marker.`,
        );
    }
    const missing = [STAGE_WORKFLOW, FINALIZE_WORKFLOW]
        .filter((name) => workflowRef(workflow, name) === null);
    return missing.length > 0
        ? result(id, 'fail', `${CALLER_WORKFLOW_FILE} must call ${missing.join(' and ')}.`)
        : result(id, 'pass', `${CALLER_WORKFLOW_FILE} is generated and unmodified.`);
}

export function shaAgreementCheck(context: CheckContext): CheckResult {
    const id = 'workflow-sha-match';
    const { workflow } = context;
    if (workflow === null) {
        return result(id, 'fail', `${CALLER_WORKFLOW_FILE} is missing.`);
    }
    const stage = workflowRef(workflow, STAGE_WORKFLOW);
    const finalize = workflowRef(workflow, FINALIZE_WORKFLOW);
    if (stage === null || finalize === null) {
        return result(id, 'fail', `${CALLER_WORKFLOW_FILE} must pin both stage.yml and finalize.yml.`);
    }
    if (stage !== finalize) {
        return result(
            id,
            'fail',
            `stage.yml is pinned to ${stage} but finalize.yml is pinned to ${finalize}.`,
        );
    }
    return result(id, 'pass', `both reusable workflows are pinned to ${stage}.`);
}

export function shaLengthCheck(context: CheckContext): CheckResult {
    const id = 'workflow-sha-length';
    const { workflow } = context;
    if (workflow === null) {
        return result(id, 'fail', `${CALLER_WORKFLOW_FILE} is missing.`);
    }
    const refs = [
        [STAGE_WORKFLOW, workflowRef(workflow, STAGE_WORKFLOW)],
        [FINALIZE_WORKFLOW, workflowRef(workflow, FINALIZE_WORKFLOW)],
    ] as const;
    const failures = refs
        .filter((entry) => entry[1] === null || !COMMIT_PATTERN.test(entry[1]))
        .map((entry) => `${entry[0]} is pinned to ${entry[1] ?? 'nothing'}`);
    if (failures.length > 0) {
        return result(
            id,
            'fail',
            `${failures.join(' and ')}; reusable workflows must use full 40-character commit SHAs.`,
        );
    }
    return result(id, 'pass', 'both reusable workflows use full 40-character commit SHAs.');
}
