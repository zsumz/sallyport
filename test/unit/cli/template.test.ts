import { describe, expect, it } from 'vitest';
import {
    isPlaceholderSha,
    normalizeCommitSha,
    PLACEHOLDER_WORKFLOW_SHA,
    QUOIN_WORKFLOW_SHA,
} from '../../../src/cli/pins.ts';
import {
    detectProfile,
    FINALIZE_WORKFLOW,
    GENERATED_MARKER,
    hasGeneratedMarker,
    readWorkflowTemplate,
    renderCallerWorkflow,
    rewriteWorkflowPins,
    STAGE_WORKFLOW,
    parseProfile,
    workflowRef,
    workflowUses,
} from '../../../src/cli/template.ts';
import { FIXTURE_SHA, OTHER_SHA } from './fixture.ts';

describe('renderCallerWorkflow', () => {
    it('leaves no template tokens behind for either profile', async () => {
        const template = await readWorkflowTemplate();

        for (const profile of ['standard', 'strict'] as const) {
            const rendered = renderCallerWorkflow(template, FIXTURE_SHA, profile);
            expect(rendered).not.toContain('__QUOIN_');
            expect(rendered.startsWith(GENERATED_MARKER)).toBe(true);
            expect(rendered.endsWith('\n')).toBe(true);
        }
    });

    it('drops the signer lines entirely for the standard profile', async () => {
        const rendered = renderCallerWorkflow(await readWorkflowTemplate(), FIXTURE_SHA, 'standard');

        expect(rendered).not.toContain('signer_fingerprint');
        expect(rendered).not.toContain('\n\n\n');
    });

    it('refuses a template without the generated-by marker', () => {
        expect(() => renderCallerWorkflow('name: x\n', FIXTURE_SHA, 'standard'))
            .toThrow(/missing the generated-by marker/u);
    });

    it('refuses a template with unknown tokens left over', () => {
        const template = `${GENERATED_MARKER}\nvalue: __QUOIN_OTHER__\n`;

        expect(() => renderCallerWorkflow(template, FIXTURE_SHA, 'standard'))
            .toThrow(/still contains unreplaced tokens/u);
    });
});

describe('workflow analysis', () => {
    it('reads uses refs with or without quotes', () => {
        const content = [
            `  uses: ${STAGE_WORKFLOW}@${FIXTURE_SHA}`,
            `  uses: "${FINALIZE_WORKFLOW}@${OTHER_SHA}"`,
            '  uses: actions/checkout@v6',
        ].join('\n');

        expect(workflowUses(content)).toHaveLength(3);
        expect(workflowRef(content, STAGE_WORKFLOW)).toBe(FIXTURE_SHA);
        expect(workflowRef(content, FINALIZE_WORKFLOW)).toBe(OTHER_SHA);
        expect(workflowRef(content, 'zsumz/other/.github/workflows/x.yml')).toBeNull();
    });

    it('detects the strict profile from a with block', () => {
        expect(detectProfile('    with:\n      profile: strict\n')).toBe('strict');
        expect(detectProfile('    with:\n      profile: \'strict\'\n')).toBe('strict');
        expect(detectProfile('    with:\n      profile: standard\n')).toBe('standard');
        expect(detectProfile('nothing here')).toBe('standard');
    });

    it('recognizes the generated marker only on the first line', () => {
        expect(hasGeneratedMarker(`${GENERATED_MARKER}\nname: x\n`)).toBe(true);
        expect(hasGeneratedMarker(`${GENERATED_MARKER}\r\nname: x\n`)).toBe(true);
        expect(hasGeneratedMarker(`name: x\n${GENERATED_MARKER}\n`)).toBe(false);
    });

    it('rewrites both pins and counts them', () => {
        const content = [
            `  uses: ${STAGE_WORKFLOW}@${FIXTURE_SHA}`,
            `  uses: ${FINALIZE_WORKFLOW}@main`,
            '  uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
        ].join('\n');

        const rewritten = rewriteWorkflowPins(content, OTHER_SHA);

        expect(rewritten.replaced).toBe(2);
        expect(workflowRef(rewritten.content, STAGE_WORKFLOW)).toBe(OTHER_SHA);
        expect(workflowRef(rewritten.content, FINALIZE_WORKFLOW)).toBe(OTHER_SHA);
        expect(rewritten.content).toContain('actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803');
    });

    it('rejects unknown profiles', () => {
        expect(parseProfile('strict')).toBe('strict');
        expect(() => parseProfile('paranoid'))
            .toThrow('Profile must be standard or strict, found paranoid.');
    });
});

describe('pinned workflow commit', () => {
    it('recognizes the placeholder and ships a real commit', () => {
        expect(isPlaceholderSha(PLACEHOLDER_WORKFLOW_SHA)).toBe(true);
        expect(isPlaceholderSha(FIXTURE_SHA)).toBe(false);
        expect(normalizeCommitSha(QUOIN_WORKFLOW_SHA)).toBe(QUOIN_WORKFLOW_SHA);
        expect(isPlaceholderSha(QUOIN_WORKFLOW_SHA)).toBe(false);
    });

    it('normalizes and validates commit shas', () => {
        expect(normalizeCommitSha(` ${FIXTURE_SHA.toUpperCase()} `)).toBe(FIXTURE_SHA);
        expect(normalizeCommitSha('main')).toBeNull();
        expect(normalizeCommitSha('a'.repeat(39))).toBeNull();
        expect(normalizeCommitSha('g'.repeat(40))).toBeNull();
    });
});
