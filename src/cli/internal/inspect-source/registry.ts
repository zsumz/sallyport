import {
    DEFAULT_REGISTRY,
    extractVersionMeta,
    fetchPackument,
} from '../../../registry/download.ts';
import { errorMessage } from '../../support.ts';
import type { CliEffects } from '../effects.ts';
import type { RegistryLookupResult } from './model.ts';

// Only staging asserts registry absence; by finalize time the version is public.
export async function lookupRegistryVersion(
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
