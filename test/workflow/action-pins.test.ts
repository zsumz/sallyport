import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const workflowDirectory = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));

const WORKFLOW_FILES = ['ci.yml', 'stage.yml', 'finalize.yml'];
const REUSABLE_FILES = ['stage.yml', 'finalize.yml'];

const PINNED_ACTIONS: Array<[string, string]> = [
    ['actions/checkout', 'd23441a48e516b6c34aea4fa41551a30e30af803'],
    ['actions/setup-node', '249970729cb0ef3589644e2896645e5dc5ba9c38'],
    ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
    ['actions/download-artifact', '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c'],
];

const FULL_SHA_REFERENCE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+@[0-9a-f]{40}$/;

function readWorkflowText(file: string): string {
    return readFileSync(`${workflowDirectory}${file}`, 'utf8');
}

function usesReferences(text: string): string[] {
    return [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((match) => match[1] ?? '');
}

describe('workflow action pins', () => {
    for (const file of WORKFLOW_FILES) {
        it(`${file} pins every action to a full 40-character commit SHA`, () => {
            const references = usesReferences(readWorkflowText(file));
            expect(references.length).toBeGreaterThan(0);
            for (const reference of references) {
                expect(reference).toMatch(FULL_SHA_REFERENCE);
            }
        });

        it(`${file} uses no local, docker, or floating action references`, () => {
            for (const reference of usesReferences(readWorkflowText(file))) {
                expect(reference.startsWith('./')).toBe(false);
                expect(reference.startsWith('../')).toBe(false);
                expect(reference.startsWith('docker://')).toBe(false);
                expect(reference).not.toMatch(/@(?:main|master|v\d)/);
            }
        });

        it(`${file} uses only the approved action versions`, () => {
            const approved = new Map(PINNED_ACTIONS);
            for (const reference of usesReferences(readWorkflowText(file))) {
                const [action = '', sha = ''] = reference.split('@');
                expect(approved.has(action)).toBe(true);
                expect(sha).toBe(approved.get(action));
            }
        });

        it(`${file} never inherits secrets`, () => {
            expect(readWorkflowText(file)).not.toContain('secrets: inherit');
        });
    }

    for (const file of REUSABLE_FILES) {
        it(`${file} references no secrets at all`, () => {
            expect(readWorkflowText(file)).not.toContain('secrets');
        });

        it(`${file} never installs a global npm release client`, () => {
            expect(readWorkflowText(file)).not.toMatch(/npm\s+install\s+--global/);
        });
    }
});
