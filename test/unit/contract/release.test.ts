import { describe, expect, it } from 'vitest';
import {
    type ReplayDecision,
    type ReplayState,
    releaseNotesPath,
    replayDecision,
} from '../../../src/contract/release.ts';

const verifiedState: ReplayState = {
    githubRelease: 'none',
    receiptMatches: true,
    assetsMatch: true,
    npmPublic: 'verified',
    provenanceVerified: true,
};

function decide(overrides: Partial<ReplayState> = {}): ReplayDecision {
    return replayDecision({ ...verifiedState, ...overrides });
}

function reasonFor(overrides: Partial<ReplayState> = {}): string {
    const decision = decide(overrides);
    return decision.action === 'fail' ? decision.reason : '';
}

describe('releaseNotesPath', () => {
    it('points at the committed notes for the tag', () => {
        expect(releaseNotesPath('0.1.2')).toBe('docs/releases/v0.1.2.md');
        expect(releaseNotesPath('1.0.0-rc.1')).toBe(
            'docs/releases/v1.0.0-rc.1.md',
        );
    });
});

describe('replayDecision', () => {
    it('creates and publishes a draft when no release exists', () => {
        expect(decide({ githubRelease: 'none' })).toEqual({
            action: 'create-draft-and-publish',
        });
    });

    it('resumes a matching draft', () => {
        expect(decide({ githubRelease: 'draft' })).toEqual({
            action: 'resume-draft-and-publish',
        });
    });

    it('is a successful no-op for a matching published release', () => {
        expect(decide({ githubRelease: 'published' })).toEqual({
            action: 'noop-already-released',
        });
    });

    it('fails hard when an existing release used a different receipt', () => {
        for (const githubRelease of ['draft', 'published'] as const) {
            const decision = decide({ githubRelease, receiptMatches: false });
            expect(decision.action).toBe('fail');
            expect(reasonFor({ githubRelease, receiptMatches: false })).toContain(
                'different candidate receipt',
            );
            expect(decision).not.toHaveProperty('critical');
        }
    });

    it('fails hard when an existing release carries different assets', () => {
        for (const githubRelease of ['draft', 'published'] as const) {
            expect(decide({ githubRelease, assetsMatch: false }).action).toBe('fail');
            expect(reasonFor({ githubRelease, assetsMatch: false })).toContain(
                'different assets',
            );
        }
    });

    it('fails without writing when the npm package is missing', () => {
        expect(decide({ npmPublic: 'missing' })).toEqual({
            action: 'fail',
            reason: 'the npm registry does not contain the released version.',
        });
    });

    it('fails critically when the public npm bytes differ', () => {
        expect(decide({ npmPublic: 'bytes-differ' })).toEqual({
            action: 'fail',
            reason: 'public npm tarball bytes differ from the candidate.',
            critical: true,
        });
    });

    it('fails without writing when provenance is missing or invalid', () => {
        expect(decide({ provenanceVerified: false })).toEqual({
            action: 'fail',
            reason: 'npm provenance is missing or invalid.',
        });
    });

    it('checks npm state before any existing github release', () => {
        expect(decide({
            githubRelease: 'published',
            npmPublic: 'bytes-differ',
        })).toEqual({
            action: 'fail',
            reason: 'public npm tarball bytes differ from the candidate.',
            critical: true,
        });
        expect(decide({
            githubRelease: 'none',
            npmPublic: 'missing',
        }).action).toBe('fail');
        expect(decide({
            githubRelease: 'draft',
            provenanceVerified: false,
        }).action).toBe('fail');
    });

    it('fails closed on unknown states', () => {
        const unknownRelease = {
            ...verifiedState,
            githubRelease: 'archived',
        } as unknown as ReplayState;
        expect(replayDecision(unknownRelease)).toEqual({
            action: 'fail',
            reason: 'unrecognized github release state: "archived".',
        });
        const unknownRegistry = {
            ...verifiedState,
            npmPublic: 'pending',
        } as unknown as ReplayState;
        expect(replayDecision(unknownRegistry)).toEqual({
            action: 'fail',
            reason: 'unrecognized npm registry state: "pending".',
        });
    });

    it('covers the whole design table', () => {
        const table: Array<[Partial<ReplayState>, ReplayDecision['action']]> = [
            [{ githubRelease: 'none' }, 'create-draft-and-publish'],
            [{ githubRelease: 'draft' }, 'resume-draft-and-publish'],
            [{ githubRelease: 'published' }, 'noop-already-released'],
            [{ githubRelease: 'published', receiptMatches: false }, 'fail'],
            [{ githubRelease: 'published', assetsMatch: false }, 'fail'],
            [{ npmPublic: 'missing' }, 'fail'],
            [{ npmPublic: 'bytes-differ' }, 'fail'],
            [{ provenanceVerified: false }, 'fail'],
        ];
        for (const [state, action] of table) {
            expect(decide(state).action).toBe(action);
        }
    });
});
