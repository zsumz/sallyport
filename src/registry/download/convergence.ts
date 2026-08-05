import { fetchDistTags, fetchPackument } from './http.ts';
import { errorMessage } from './json.ts';
import {
    retryPlan,
    type RegistryConvergence,
    type RegistryConvergenceInput,
    type RegistryFetch,
    type RegistryLookup,
    type RegistryState,
} from './model.ts';
import { classifyRegistryState, shouldContinue } from './state.ts';
import { DEFAULT_REGISTRY } from './urls.ts';

export async function awaitRegistryConvergence(
    input: RegistryConvergenceInput,
): Promise<RegistryConvergence> {
    const registry = input.registry ?? DEFAULT_REGISTRY;
    const lookup: RegistryLookup = { registry, packageName: input.candidate.package.name };
    let state: RegistryState = {
        state: 'pending',
        reason: 'the registry has not been queried yet.',
    };
    for (let attempt = 1; attempt <= retryPlan.attempts; attempt += 1) {
        state = await observeRegistryState(input.fetch, lookup, input.candidate, registry);
        if (!shouldContinue(attempt, state)) {
            return { state, attempts: attempt };
        }
        await input.sleep(retryPlan.intervalMs);
    }
    return { state, attempts: retryPlan.attempts };
}

async function observeRegistryState(
    registryFetch: RegistryFetch,
    lookup: RegistryLookup,
    candidate: RegistryConvergenceInput['candidate'],
    registry: string,
): Promise<RegistryState> {
    try {
        const packument = await fetchPackument(registryFetch.fetchJson, lookup);
        const distTags = await fetchDistTags(registryFetch.fetchJson, lookup);
        return classifyRegistryState({ candidate, packument, distTags, registry });
    } catch (error) {
        return { state: 'pending', reason: `registry query failed: ${errorMessage(error)}` };
    }
}
