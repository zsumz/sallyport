import { replayDecision, type ReplayDecision } from '../../contract/release.ts';
import {
    RECEIPT_ASSET_NAMES,
    type ExpectedRelease,
    type ReleasePlan,
    type ReleaseState,
} from './model.ts';

interface AssetComparison {
    receiptMatches: boolean;
    assetsMatch: boolean;
    missing: string[];
    failures: string[];
}

// Design §12. The replay table itself lives in src/contract/release.ts; this is
// the adapter that turns observed GitHub state into that table's inputs.
export function planReleaseAction(
    existing: ReleaseState | null,
    expected: ExpectedRelease,
): ReleasePlan {
    if (existing === null) {
        const decision = replayDecision({
            githubRelease: 'none',
            receiptMatches: true,
            assetsMatch: true,
            npmPublic: expected.npmPublic,
            provenanceVerified: expected.provenanceVerified,
        });
        if (decision.action === 'create-draft-and-publish') {
            return { action: 'create' };
        }
        return conflictPlan(decision, []);
    }
    const comparison = compareAssets(existing, expected);
    const decision = replayDecision({
        githubRelease: existing.draft ? 'draft' : 'published',
        receiptMatches: comparison.receiptMatches,
        assetsMatch: comparison.assetsMatch,
        npmPublic: expected.npmPublic,
        provenanceVerified: expected.provenanceVerified,
    });
    switch (decision.action) {
        case 'resume-draft-and-publish':
            return { action: 'resume', release: existing, missing: comparison.missing };
        case 'noop-already-released':
            return { action: 'noop', release: existing };
        case 'create-draft-and-publish':
        case 'fail':
            return conflictPlan(decision, comparison.failures);
    }
}

function compareAssets(existing: ReleaseState, expected: ExpectedRelease): AssetComparison {
    const wanted = new Map(
        expected.assets.map((asset) => [asset.name, asset.sha256.toLowerCase()]),
    );
    const comparison: AssetComparison = {
        receiptMatches: true,
        assetsMatch: true,
        missing: [],
        failures: [],
    };
    const present: string[] = [];
    for (const asset of existing.assets) {
        const want = wanted.get(asset.name);
        if (want === undefined) {
            comparison.assetsMatch = false;
            comparison.failures.push(
                `Release ${existing.tagName} carries unexpected asset ${asset.name}.`,
            );
            continue;
        }
        const digest = normalizeDigest(asset.digest);
        if (digest === null) {
            recordMismatch(
                comparison,
                asset.name,
                `Release ${existing.tagName} asset ${asset.name} publishes no digest to compare.`,
            );
            continue;
        }
        if (digest !== want) {
            recordMismatch(
                comparison,
                asset.name,
                `Release ${existing.tagName} asset ${asset.name} has digest ${digest}, expected ${want}.`,
            );
            continue;
        }
        present.push(asset.name);
    }
    comparison.missing = expected.assets
        .map((asset) => asset.name)
        .filter((name) => !present.includes(name));
    if (!existing.draft && comparison.missing.length > 0) {
        comparison.assetsMatch = false;
        comparison.failures.push(
            `Published release ${existing.tagName} is missing assets: ${comparison.missing.join(', ')}.`,
        );
    }
    return comparison;
}

function recordMismatch(
    comparison: AssetComparison,
    name: string,
    failure: string,
): void {
    if (RECEIPT_ASSET_NAMES.some((receipt) => receipt === name)) {
        comparison.receiptMatches = false;
    } else {
        comparison.assetsMatch = false;
    }
    comparison.failures.push(failure);
}

function conflictPlan(decision: ReplayDecision, details: readonly string[]): ReleasePlan {
    const reason = decision.action === 'fail'
        ? decision.reason
        : `unexpected replay decision ${decision.action}.`;
    return {
        action: 'conflict',
        critical: decision.action === 'fail' && (decision.critical ?? false),
        failures: [reason, ...details],
    };
}

function normalizeDigest(digest: string | null): string | null {
    if (digest === null) {
        return null;
    }
    const value = digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : digest;
    return /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
}
