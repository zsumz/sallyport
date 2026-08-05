// The quoin release process pins the last commit that touched the reusable
// workflows. A commit cannot reference its own SHA; see docs/releasing.md.
export const PLACEHOLDER_WORKFLOW_SHA = '0000000000000000000000000000000000000000';

export const QUOIN_WORKFLOW_SHA = '219be03b4d9cddec6b13f505bc142432cd7a9c89';

const COMMIT_PATTERN = /^[0-9a-fA-F]{40}$/u;

export function normalizeCommitSha(value: string): string | null {
    const compact = value.trim();
    return COMMIT_PATTERN.test(compact) ? compact.toLowerCase() : null;
}

export function isPlaceholderSha(value: string): boolean {
    return value.toLowerCase() === PLACEHOLDER_WORKFLOW_SHA;
}
