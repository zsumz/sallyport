import { releaseTagForVersion } from './semver.ts';

export const RELEASE_NOTES_DIRECTORY = 'docs/releases';

export type GithubReleaseState = 'none' | 'draft' | 'published';
export type NpmPublicState = 'missing' | 'bytes-differ' | 'verified';

export interface ReplayState {
    githubRelease: GithubReleaseState;
    // True when the existing release carries no conflicting receipt/assets,
    // so resuming cannot overwrite a different candidate.
    receiptMatches: boolean;
    assetsMatch: boolean;
    npmPublic: NpmPublicState;
    provenanceVerified: boolean;
}

export type ReplayDecision =
    | { action: 'create-draft-and-publish' }
    | { action: 'resume-draft-and-publish' }
    | { action: 'noop-already-released' }
    | { action: 'fail'; reason: string; critical?: true };

export function releaseNotesPath(version: string): string {
    return `${RELEASE_NOTES_DIRECTORY}/${releaseTagForVersion(version)}.md`;
}

export function replayDecision(state: ReplayState): ReplayDecision {
    switch (state.npmPublic) {
        case 'bytes-differ':
            return criticalFailure(
                'public npm tarball bytes differ from the candidate.',
            );
        case 'missing':
            return failure(
                'the npm registry does not contain the released version.',
            );
        case 'verified':
            break;
        default:
            return unrecognized('npm registry', state.npmPublic);
    }
    if (!state.provenanceVerified) {
        return failure('npm provenance is missing or invalid.');
    }
    switch (state.githubRelease) {
        case 'none':
            return { action: 'create-draft-and-publish' };
        case 'draft':
            return conflictFailure(state) ?? { action: 'resume-draft-and-publish' };
        case 'published':
            return conflictFailure(state) ?? { action: 'noop-already-released' };
        default:
            return unrecognized('github release', state.githubRelease);
    }
}

function conflictFailure(state: ReplayState): ReplayDecision | null {
    if (!state.receiptMatches) {
        return failure(
            'an existing github release for this tag was built from a different candidate receipt.',
        );
    }
    if (!state.assetsMatch) {
        return failure(
            'an existing github release for this tag carries different assets.',
        );
    }
    return null;
}

function failure(reason: string): ReplayDecision {
    return { action: 'fail', reason };
}

function criticalFailure(reason: string): ReplayDecision {
    return { action: 'fail', reason, critical: true };
}

function unrecognized(kind: string, value: unknown): ReplayDecision {
    return failure(`unrecognized ${kind} state: ${JSON.stringify(value)}.`);
}
