import { sha256Hex } from '../../registry/integrity.ts';
import {
    createDraftRelease,
    getReleaseByTag,
    publishDraftRelease,
    uploadReleaseAsset,
} from './api.ts';
import type {
    ExpectedRelease,
    ReleaseAssetUpload,
    ReleaseBundleInput,
    ReleasePublication,
    ReleaseState,
} from './model.ts';
import { planReleaseAction } from './plan.ts';

// Draft-first publication. Conflicts are hard failures: nothing is ever
// deleted, overwritten, or republished.
export async function publishReleaseBundle(
    input: ReleaseBundleInput,
): Promise<ReleasePublication> {
    const expected: ExpectedRelease = {
        tag: input.draft.tag,
        assets: input.assets.map((asset) => ({
            name: asset.name,
            sha256: sha256Hex(asset.data),
        })),
        npmPublic: input.npmPublic,
        provenanceVerified: input.provenanceVerified,
    };
    const existing = await getReleaseByTag(input.fetchJson, input.target, input.draft.tag);
    if (existing !== null && existing.tagName !== input.draft.tag) {
        throw new Error(
            `Release publication failed: GitHub returned release ${existing.tagName} for tag ${input.draft.tag}.`,
        );
    }
    const plan = planReleaseAction(existing, expected);
    switch (plan.action) {
        case 'conflict':
            throw new Error(
                `Release publication failed: ${plan.failures.join(' ')}`,
            );
        case 'noop':
            return {
                action: 'noop',
                releaseId: plan.release.id,
                htmlUrl: plan.release.htmlUrl,
            };
        case 'create': {
            const created = await createDraftRelease(
                input.fetchJson,
                input.target,
                input.draft,
            );
            const published = await uploadAndPublish(input, created, input.assets);
            return { action: 'created', releaseId: published.id, htmlUrl: published.htmlUrl };
        }
        case 'resume': {
            const pending = input.assets.filter(
                (asset) => plan.missing.includes(asset.name),
            );
            const published = await uploadAndPublish(input, plan.release, pending);
            return { action: 'resumed', releaseId: published.id, htmlUrl: published.htmlUrl };
        }
    }
}

async function uploadAndPublish(
    input: ReleaseBundleInput,
    release: ReleaseState,
    assets: readonly ReleaseAssetUpload[],
): Promise<ReleaseState> {
    for (const asset of assets) {
        await uploadReleaseAsset(input.fetchJson, input.target, release, asset);
    }
    return publishDraftRelease(
        input.fetchJson,
        input.target,
        release,
        input.draft.prerelease,
    );
}
