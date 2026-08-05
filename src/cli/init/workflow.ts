import { writeFile } from 'node:fs/promises';

import { QUOIN_WORKFLOW_SHA, isPlaceholderSha, normalizeCommitSha } from '../pins.ts';
import { readTextFile } from '../support.ts';
import {
    CALLER_WORKFLOW_FILE,
    hasGeneratedMarker,
    readWorkflowTemplate,
    renderCallerWorkflow,
    rewriteWorkflowPins,
    type Profile,
} from '../template.ts';

const EXPECTED_PINS = 2;

export function resolveWorkflowSha(requested: string | undefined): string {
    if (requested !== undefined) {
        const normalized = normalizeCommitSha(requested);
        if (normalized === null) {
            throw new Error(
                'Installation failed: --sha must be a full 40-character commit SHA.',
            );
        }
        return normalized;
    }
    const pinned = normalizeCommitSha(QUOIN_WORKFLOW_SHA);
    if (pinned === null || isPlaceholderSha(pinned)) {
        throw new Error(
            'Installation failed: this build of quoin carries no pinned workflow commit;'
            + ' pass --sha <commit> until the first quoin release bakes one in.'
            + ' Reusable workflows are never pinned to a mutable ref.',
        );
    }
    return pinned;
}

export async function generateCallerWorkflow(
    file: string,
    sha: string,
    profile: Profile,
): Promise<void> {
    const existing = await readTextFile(file);
    if (existing !== null) {
        throw new Error(
            `Installation failed: ${CALLER_WORKFLOW_FILE} already exists;`
            + ' rerun with --upgrade to update its pinned commit.',
        );
    }
    const template = await readWorkflowTemplate();
    await writeFile(file, renderCallerWorkflow(template, sha, profile));
}

// --upgrade rewrites the two pins and nothing else, so a consumer's profile and
// any surrounding structure survive the update.
export async function upgradeCallerWorkflow(
    file: string,
    sha: string,
    force: boolean,
): Promise<void> {
    const existing = await readTextFile(file);
    if (existing === null) {
        throw new Error(
            `Installation failed: ${CALLER_WORKFLOW_FILE} does not exist;`
            + ' run npx quoin init to generate it.',
        );
    }
    if (!hasGeneratedMarker(existing) && !force) {
        throw new Error(
            `Installation failed: ${CALLER_WORKFLOW_FILE} does not start with the quoin`
            + ' generated-by marker; rerun with --force to upgrade it anyway.',
        );
    }
    const rewritten = rewriteWorkflowPins(existing, sha);
    if (rewritten.replaced !== EXPECTED_PINS) {
        throw new Error(
            `Installation failed: ${CALLER_WORKFLOW_FILE} must pin stage.yml and finalize.yml;`
            + ` found ${String(rewritten.replaced)} quoin workflow references.`,
        );
    }
    await writeFile(file, rewritten.content);
}
