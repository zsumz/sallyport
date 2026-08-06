import { isDeepStrictEqual } from 'node:util';

const COMMIT = /^[0-9a-f]{40}$/u;
const PIN_LITERAL = /export const SALLYPORT_WORKFLOW_SHA = '([0-9a-f]{40})';/gu;
const WORKFLOW_PIN = /(uses:\s*zsumz\/sallyport\/\.github\/workflows\/(stage|finalize)\.yml)@([0-9a-f]{40})/gu;

const SELF_REFERENTIAL_RELEASE_FILES = new Set([
    '.github/workflows/sallyport.yml',
    'src/cli/pins.ts',
]);

export function releaseFileFailure(file: string): string | null {
    return SELF_REFERENTIAL_RELEASE_FILES.has(file)
        ? null
        : `${file} must be finalized in the implementation checkpoint; `
            + 'only self-referential release pins may change above it.';
}

export function releaseLayerFailure(
    file: string,
    checkpoint: string,
    head: string,
): string | null {
    try {
        const before = normalize(file, checkpoint);
        const after = normalize(file, head);
        return isDeepStrictEqual(before, after)
            ? null
            : `${file} changes more than its permitted release fields.`;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `${file} cannot be compared semantically: ${message}`;
    }
}

export function releaseShaAgreementFailure(
    pinSource: string,
    workflowSource: string,
    checkpoint: string,
): string | null {
    try {
        if (!COMMIT.test(checkpoint)) {
            throw new Error('checkpoint must be a full lowercase commit SHA.');
        }
        const packaged = extractPinLiteral(pinSource);
        const workflows = extractWorkflowPins(workflowSource);
        if (packaged === checkpoint
            && workflows.stage === checkpoint
            && workflows.finalize === checkpoint) {
            return null;
        }
        return [
            'release SHA values must equal the protocol checkpoint',
            `${checkpoint}: SALLYPORT_WORKFLOW_SHA=${packaged},`,
            `stage.yml=${workflows.stage}, finalize.yml=${workflows.finalize}.`,
        ].join(' ');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `release SHA values cannot be compared: ${message}`;
    }
}

function normalize(file: string, source: string): unknown {
    switch (file) {
        case 'src/cli/pins.ts':
            extractPinLiteral(source);
            return replaceExactly(
                source,
                PIN_LITERAL,
                'export const SALLYPORT_WORKFLOW_SHA = \'<release-sha>\';',
                1,
            );
        case '.github/workflows/sallyport.yml':
            return replaceWorkflowPins(source);
        default:
            throw new Error('file is not part of the semantic release layer.');
    }
}

function replaceWorkflowPins(source: string): string {
    extractWorkflowPins(source);
    return source.replace(WORKFLOW_PIN, (_match, prefix: string) =>
        `${prefix}@<release-sha>`);
}

function extractPinLiteral(source: string): string {
    const matches = [...source.matchAll(PIN_LITERAL)];
    const value = matches[0]?.[1];
    if (matches.length !== 1 || value === undefined) {
        throw new Error(
            `packaged CLI must contain exactly one workflow SHA; found ${String(matches.length)}.`,
        );
    }
    return value;
}

function extractWorkflowPins(source: string): { stage: string; finalize: string } {
    const matches = [...source.matchAll(WORKFLOW_PIN)];
    const pins: Partial<Record<'stage' | 'finalize', string>> = {};
    for (const match of matches) {
        const kind = match[2];
        const sha = match[3];
        if (kind !== 'stage' && kind !== 'finalize' || sha === undefined || pins[kind] !== undefined) {
            throw new Error(
                'caller workflow must contain exactly one stage pin and one finalize pin.',
            );
        }
        pins[kind] = sha;
    }
    if (matches.length !== 2 || pins.stage === undefined || pins.finalize === undefined) {
        throw new Error(
            'caller workflow must contain exactly one stage pin and one finalize pin.',
        );
    }
    return { stage: pins.stage, finalize: pins.finalize };
}

function replaceExactly(
    source: string,
    pattern: RegExp,
    replacement: string,
    count: number,
): string {
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== count) {
        throw new Error(`expected ${String(count)} releasable literal, found ${String(matches.length)}.`);
    }
    return source.replace(pattern, replacement);
}
