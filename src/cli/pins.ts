// The quoin release process rewrites QUOIN_WORKFLOW_SHA to the last
// commit that touched .github/workflows/ (a commit cannot reference its own
// SHA; see docs/releasing.md). Until then it stays at the placeholder so
// `init` refuses to emit a caller workflow pinned to nothing.
export const PLACEHOLDER_WORKFLOW_SHA = '0000000000000000000000000000000000000000';

export const QUOIN_WORKFLOW_SHA: string = PLACEHOLDER_WORKFLOW_SHA;

const COMMIT_PATTERN = /^[0-9a-fA-F]{40}$/u;

export function normalizeCommitSha(value: string): string | null {
    const compact = value.trim();
    return COMMIT_PATTERN.test(compact) ? compact.toLowerCase() : null;
}

export function isPlaceholderSha(value: string): boolean {
    return value.toLowerCase() === PLACEHOLDER_WORKFLOW_SHA;
}
