// The sallyport release layer pins the complete implementation checkpoint.
// A commit cannot reference its own SHA; see docs/releasing.md.
export const PLACEHOLDER_WORKFLOW_SHA = '0000000000000000000000000000000000000000';

export const SALLYPORT_WORKFLOW_SHA = 'e0815302fa18bc3e91fbc26b0e15ebbe1bc95cac';

const COMMIT_PATTERN = /^[0-9a-fA-F]{40}$/u;

export function normalizeCommitSha(value: string): string | null {
    const compact = value.trim();
    return COMMIT_PATTERN.test(compact) ? compact.toLowerCase() : null;
}

export function isPlaceholderSha(value: string): boolean {
    return value.toLowerCase() === PLACEHOLDER_WORKFLOW_SHA;
}
