import path from 'node:path';
import { readPackageMetadata, validatePackageContract } from '../../contract/package.ts';
import { releaseNotesPath } from '../../contract/release.ts';
import { deriveDistTag, releaseTagForVersion } from '../../contract/semver.ts';
import {
    normalizeFingerprint,
    verifySignedTag,
    verifyTagReachableFromBranch,
} from '../../contract/signing.ts';
import {
    DEFAULT_REGISTRY,
    extractVersionMeta,
    fetchPackument,
} from '../../registry/download.ts';
import { optionalValue, parseArgv, requirePositiveInteger, requireValue } from '../args.ts';
import { errorMessage, failure, isFile } from '../support.ts';
import { parseProfile, type Profile } from '../template.ts';
import type { CliEffects } from './effects.ts';

export type InspectMode = 'stage' | 'finalize';

export const INSPECT_SOURCE_FLAGS = [
    'consumer',
    'profile',
    'tag',
    'repository',
    'repository-id',
    'default-branch',
    'signer-fingerprint',
    'mode',
] as const;

interface RegistryLookupResult {
    present: boolean;
    failures: string[];
}

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
    const requestedFingerprint = optionalValue(parsed, 'signer-fingerprint');
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

    const fingerprint = requestedFingerprint === undefined
        ? null
        : normalizeFingerprint(requestedFingerprint);
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
    await effects.writeSummary(summary({
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

function parseMode(value: string | undefined): InspectMode {
    if (value === undefined || value === '') {
        return 'stage';
    }
    if (value !== 'stage' && value !== 'finalize') {
        throw new Error(`Source inspection failed: --mode must be stage or finalize, found ${value}.`);
    }
    return value;
}

// Only staging asserts registry absence; by finalize time the version is public
// on purpose, so repeating the check there would always fail.
async function lookupRegistryVersion(
    effects: CliEffects,
    name: string,
    version: string,
): Promise<RegistryLookupResult> {
    const registry = effects.env.NPM_CONFIG_REGISTRY ?? DEFAULT_REGISTRY;
    try {
        const packument = await fetchPackument(effects.registry.fetchJson, {
            registry,
            packageName: name,
        });
        const lookup = extractVersionMeta(packument, name, version);
        if (lookup.outcome === 'malformed') {
            return { present: false, failures: lookup.failures };
        }
        return { present: lookup.outcome === 'found', failures: [] };
    } catch (error) {
        return {
            present: false,
            failures: [`the npm registry could not be queried: ${errorMessage(error)}`],
        };
    }
}

function strictFailures(
    effects: CliEffects,
    consumerDir: string,
    tag: string,
    fingerprint: string | null,
): string[] {
    if (fingerprint === null) {
        return [
            'the strict profile requires a 40-hexadecimal signer fingerprint in'
            + ' QUOIN_SIGNER_FINGERPRINT.',
        ];
    }
    const signature = verifySignedTag({
        tag,
        expectedFingerprint: fingerprint,
        cwd: consumerDir,
        exec: effects.exec,
    });
    return signature.ok ? [] : signature.failures;
}

interface SummaryInput {
    name: string;
    version: string;
    tag: string;
    distTag: string;
    profile: Profile;
    mode: InspectMode;
    repository: string;
    repositoryId: number;
    fingerprint: string | null;
}

function summary(input: SummaryInput): string {
    return [
        '### quoin source inspection',
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| Package | \`${input.name}@${input.version}\` |`,
        `| Tag | \`${input.tag}\` |`,
        `| Dist-tag | \`${input.distTag}\` |`,
        `| Repository | \`${input.repository}\` (${String(input.repositoryId)}) |`,
        `| Profile | \`${input.profile}\` |`,
        `| Mode | \`${input.mode}\` |`,
        `| Signer | \`${input.fingerprint ?? 'unsigned'}\` |`,
        '',
    ].join('\n');
}
