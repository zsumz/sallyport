import path from 'node:path';

import { readPackageMetadata, validatePackageContract } from '../../../contract/package.ts';
import { releaseNotesPath } from '../../../contract/release.ts';
import { deriveDistTag, releaseTagForVersion } from '../../../contract/semver.ts';
import { verifyTagReachableFromBranch } from '../../../contract/signing.ts';
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
    const defaultBranch = requireValue(parsed, 'default-branch');
    const fingerprint = requestedFingerprint(optionalValue(parsed, 'signer-fingerprint'));
    const mode = parseMode(optionalValue(parsed, 'mode') ?? effects.env.QUOIN_MODE);

    const metadata = await readPackageMetadata(consumerDir);
    const failures: string[] = [];
    const name = metadata.name ?? '';
    const version = metadata.version ?? '';
    if (name === '') {
        failures.push('package.json must declare a name.');
    }
    if (version === '') {
        throw failure('Source inspection failed:', [
            ...failures,
            'package.json must declare a version.',
        ]);
    }

    const expectedTag = releaseTagForVersion(version);
    if (tag !== expectedTag) {
        failures.push(`release tag ${tag} must be ${expectedTag}.`);
    }
    const decision = deriveDistTag(version);
    const distTag = 'distTag' in decision ? decision.distTag : '';
    if ('error' in decision) {
        failures.push(decision.error);
    }

    const hasReleaseNotes = await isFile(path.join(consumerDir, releaseNotesPath(version)));
    const registry = mode === 'stage' && name !== ''
        ? await lookupRegistryVersion(effects, name, version)
        : { present: false, failures: [] };
    failures.push(...registry.failures);
    failures.push(...validatePackageContract({
        ...metadata,
        tag,
        expectedRepository: repository,
        registryHasVersion: registry.present,
        hasReleaseNotes,
    }));

    if (profile === 'strict') {
        failures.push(...strictFailures(effects, consumerDir, tag, fingerprint));
    }
    const reachable = verifyTagReachableFromBranch({
        tag,
        branch: defaultBranch,
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
