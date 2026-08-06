import { isDeepStrictEqual } from 'node:util';

const PIN_LITERAL = /export const SALLYPORT_WORKFLOW_SHA = '[0-9a-f]{40}';/gu;
const WORKFLOW_PIN = /(uses:\s*zsumz\/sallyport\/\.github\/workflows\/(stage|finalize)\.yml)@[0-9a-f]{40}/gu;

export const SEMANTIC_RELEASE_FILES = new Set([
    '.github/workflows/sallyport.yml',
    'package-lock.json',
    'package.json',
    'src/cli/pins.ts',
]);

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

export function releaseNoteFailure(
    status: string,
    file: string,
    version: string,
): string | null {
    const expected = `docs/releases/v${version}.md`;
    if (file !== expected) {
        return `${file} is not the current release note ${expected}.`;
    }
    return status === 'A'
        ? null
        : `${expected} must be newly added after the implementation checkpoint.`;
}

function normalize(file: string, source: string): unknown {
    switch (file) {
        case 'package.json':
            return normalizePackage(source);
        case 'package-lock.json':
            return normalizeLockfile(source);
        case 'src/cli/pins.ts':
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

function normalizePackage(source: string): unknown {
    const document = jsonObject(source, 'package.json');
    requireString(document.version, 'package.json version');
    return { ...document, version: '<release-version>' };
}

function normalizeLockfile(source: string): unknown {
    const document = jsonObject(source, 'package-lock.json');
    const packages = objectProperty(document, 'packages', 'package-lock.json packages');
    const root = objectProperty(packages, '', 'package-lock.json root package');
    requireString(document.version, 'package-lock.json version');
    requireString(root.version, 'package-lock.json root package version');
    return {
        ...document,
        version: '<release-version>',
        packages: {
            ...packages,
            '': { ...root, version: '<release-version>' },
        },
    };
}

function replaceWorkflowPins(source: string): string {
    const kinds: string[] = [];
    const normalized = source.replace(WORKFLOW_PIN, (_match, prefix: string, kind: string) => {
        kinds.push(kind);
        return `${prefix}@<release-sha>`;
    });
    if (kinds.length !== 2 || [...kinds].sort().join(',') !== 'finalize,stage') {
        throw new Error('caller workflow must contain exactly one stage pin and one finalize pin.');
    }
    return normalized;
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

function jsonObject(source: string, label: string): Record<string, unknown> {
    const value = JSON.parse(source) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be a JSON object.`);
    }
    return value as Record<string, unknown>;
}

function objectProperty(
    source: Record<string, unknown>,
    key: string,
    label: string,
): Record<string, unknown> {
    const value = source[key];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be a JSON object.`);
    }
    return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || value === '') {
        throw new Error(`${label} must be a nonempty string.`);
    }
}
