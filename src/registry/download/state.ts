import type { CandidateReceipt } from '../../candidate/receipt.ts';
import { readProperty, readStringProperty } from './json.ts';
import {
    retryPlan,
    type RegistryState,
    type RegistryStateInput,
    type RegistryVersionMeta,
    type VersionMetaLookup,
} from './model.ts';
import { DEFAULT_REGISTRY } from './urls.ts';

export function extractVersionMeta(
    packument: unknown,
    packageName: string,
    version: string,
): VersionMetaLookup {
    const documentName = readStringProperty(packument, 'name');
    if (documentName !== null && documentName !== packageName) {
        return {
            outcome: 'malformed',
            failures: [`Registry document is for ${documentName}, expected ${packageName}.`],
        };
    }
    const entry = readProperty(readProperty(packument, 'versions'), version);
    if (typeof entry !== 'object' || entry === null) {
        return { outcome: 'absent' };
    }
    const failures: string[] = [];
    const entryVersion = readStringProperty(entry, 'version');
    if (entryVersion !== null && entryVersion !== version) {
        failures.push(
            `Registry metadata for ${packageName}@${version} declares version ${entryVersion}.`,
        );
    }
    const dist = readProperty(entry, 'dist');
    const tarball = readStringProperty(dist, 'tarball');
    const integrity = readStringProperty(dist, 'integrity');
    const shasum = readStringProperty(dist, 'shasum');
    if (tarball === null) {
        failures.push(`Registry metadata for ${packageName}@${version} has no dist.tarball.`);
    }
    if (integrity === null) {
        failures.push(`Registry metadata for ${packageName}@${version} has no dist.integrity.`);
    }
    if (shasum === null) {
        failures.push(`Registry metadata for ${packageName}@${version} has no dist.shasum.`);
    }
    if (tarball === null || integrity === null || shasum === null || failures.length > 0) {
        return { outcome: 'malformed', failures };
    }
    return { outcome: 'found', meta: { version, tarball, integrity, shasum } };
}

export function classifyRegistryState(input: RegistryStateInput): RegistryState {
    const registry = input.registry ?? DEFAULT_REGISTRY;
    const { candidate } = input;
    const packageName = candidate.package.name;
    const { version, distTag } = candidate.package;
    const lookup = extractVersionMeta(input.packument, packageName, version);
    if (lookup.outcome === 'malformed') {
        return { state: 'mismatch', failures: lookup.failures };
    }
    if (lookup.outcome === 'absent') {
        return {
            state: 'pending',
            reason: `${packageName}@${version} is not visible on ${registry} yet.`,
        };
    }
    const failures = permanentFailures(lookup.meta, candidate, registry);
    if (failures.length > 0) {
        return { state: 'mismatch', failures };
    }
    const tagged = readStringProperty(input.distTags, distTag);
    if (tagged === null) {
        return {
            state: 'pending',
            reason: `dist-tag ${distTag} is not visible for ${packageName} yet.`,
        };
    }
    // A later release may legitimately have moved the tag; that is only fatal
    // once the bounded convergence window is exhausted.
    if (tagged !== version) {
        return {
            state: 'pending',
            reason: `dist-tag ${distTag} points at ${tagged}, expected ${version}.`,
        };
    }
    return { state: 'converged', versionMeta: lookup.meta };
}

export function shouldContinue(attempt: number, state: RegistryState): boolean {
    return state.state === 'pending' && attempt < retryPlan.attempts;
}

function permanentFailures(
    meta: RegistryVersionMeta,
    candidate: CandidateReceipt,
    registry: string,
): string[] {
    const failures: string[] = [];
    if (meta.integrity !== candidate.tarball.integrity) {
        failures.push(
            `Registry integrity ${meta.integrity} does not match candidate ${candidate.tarball.integrity}.`,
        );
    }
    const tarballOrigin = urlOrigin(meta.tarball);
    const registryOrigin = urlOrigin(registry);
    if (tarballOrigin === null) {
        failures.push(`Registry tarball URL is not usable: ${meta.tarball}.`);
    } else if (registryOrigin !== null && tarballOrigin !== registryOrigin) {
        failures.push(
            `Registry tarball origin ${tarballOrigin} does not match ${registryOrigin}.`,
        );
    }
    return failures;
}

function urlOrigin(value: string): string | null {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}
