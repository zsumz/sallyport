import path from 'node:path';

import {
    readReleaseMetadata,
    validateReleaseContract,
} from '../../../contract/package.ts';
import { releaseNotesPath } from '../../../contract/release.ts';
import { deriveDistTag, releaseTagForVersion } from '../../../contract/semver.ts';
import {
    resolveTagObject,
    verifyTagCommit,
    verifyTagReachableFromBranch,
} from '../../../contract/signing.ts';
import { optionalValue, parseArgv, requirePositiveInteger, requireValue } from '../../args.ts';
import { failure, isFile } from '../../support.ts';
import { parseProfile } from '../../template.ts';
import type { CliEffects } from '../effects.ts';
import { INSPECT_SOURCE_FLAGS } from './model.ts';
import { parseMode, requestedFingerprint, strictFailures } from './policy.ts';
import { lookupRegistryVersion } from './registry.ts';
import { sourceSummary } from './summary.ts';

export async function inspectSourceCommand(
    argv: readonly string[],
    effects: CliEffects,
): Promise<void> {
    const parsed = parseArgv(argv, { strings: [...INSPECT_SOURCE_FLAGS] });
    const consumerDir = path.resolve(requireValue(parsed, 'consumer'));
    const profile = parseProfile(requireValue(parsed, 'profile'));
    const tag = requireValue(parsed, 'tag');
    const repository = requireValue(parsed, 'repository');
    const repositoryId = requirePositiveInteger(parsed, 'repository-id');
    const defaultBranchRef = requireValue(parsed, 'default-branch-ref');
    const expectedCommit = requireValue(parsed, 'expected-commit');
    const expectedTagObject = optionalValue(parsed, 'expected-tag-object');
    const fingerprint = requestedFingerprint(optionalValue(parsed, 'signer-fingerprint'));
    const mode = parseMode(optionalValue(parsed, 'mode') ?? effects.env.SALLYPORT_MODE);

    const release = await readReleaseMetadata(consumerDir);
    const failures: string[] = [];
    const name = release.root.name ?? '';
    const version = release.root.version ?? '';
    if (name === '') failures.push('package.json must declare a name.');
    if (version === '') {
        throw failure('Source inspection failed:', [
            ...failures,
            'package.json must declare a version.',
        ]);
    }

    const expectedTag = releaseTagForVersion(version);
    if (tag !== expectedTag) {
        failures.push('release tag ' + tag + ' must be ' + expectedTag + '.');
    }
    const decision = deriveDistTag(version);
    const distTag = 'distTag' in decision ? decision.distTag : '';
    if ('error' in decision) failures.push(decision.error);

    const registryVersions: Set<string> = new Set();
    if (mode === 'stage') {
        for (const member of release.packages) {
            if (member.name === undefined || member.version === undefined) continue;
            const registry = await lookupRegistryVersion(
                effects,
                member.name,
                member.version,
            );
            failures.push(...registry.failures);
            if (registry.present) {
                registryVersions.add(member.name + '@' + member.version);
            }
        }
    }
    const hasReleaseNotes = await isFile(path.join(consumerDir, releaseNotesPath(version)));
    failures.push(...validateReleaseContract({
        metadata: release,
        tag,
        expectedRepository: repository,
        registryVersions,
        hasReleaseNotes,
    }));

    if (profile === 'strict') {
        failures.push(...strictFailures(effects, consumerDir, tag, fingerprint));
    }
    const commit = verifyTagCommit({
        tag,
        expectedCommit,
        cwd: consumerDir,
        exec: effects.exec,
    });
    if (!commit.ok) {
        failures.push(...commit.failures);
    }
    const tagObject = resolveTagObject({ tag, cwd: consumerDir, exec: effects.exec });
    if (tagObject === null) {
        failures.push(`${tag} must resolve to an exact Git object.`);
    } else if (expectedTagObject !== undefined && tagObject !== expectedTagObject) {
        failures.push(
            `${tag} currently references object ${tagObject}, expected ${expectedTagObject}.`,
        );
    }
    const reachable = verifyTagReachableFromBranch({
        tag,
        branch: defaultBranchRef,
        cwd: consumerDir,
        exec: effects.exec,
    });
    if (!reachable.ok) {
        failures.push(...reachable.failures);
    }
    if (failures.length > 0) {
        throw failure(`Source inspection failed for ${tag}:`, failures);
    }

    await effects.writeOutput({
        package_name: name,
        package_version: version,
        dist_tag: distTag,
        tag_object: tagObject ?? '',
        package_count: String(release.packages.length),
        release_name: name,
    });
    await effects.writeSummary(sourceSummary({
        name,
        version,
        tag,
        distTag,
        profile,
        mode,
        repository,
        repositoryId,
        fingerprint,
    }));
}
