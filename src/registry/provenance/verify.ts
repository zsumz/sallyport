import {
    attestationsUrl,
    errorMessage,
    type FetchJson,
} from '../download.ts';
import { runAuditSignatures, verifyAuditSignatures } from './audit.ts';
import { verifyProvenanceIdentity } from './identity.ts';
import type {
    ProvenanceResult,
    ProvenanceVerificationInput,
} from './model.ts';

export async function fetchAttestations(
    fetchJson: FetchJson,
    registry: string,
    packageName: string,
    version: string,
): Promise<unknown> {
    const url = attestationsUrl(registry, packageName, version);
    const response = await fetchJson(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        body: null,
    });
    if (response.status === 404) {
        return null;
    }
    if (response.status !== 200) {
        throw new Error(`Registry request failed: ${url} returned ${String(response.status)}.`);
    }
    return response.body;
}

export async function verifyRegistryProvenance(
    input: ProvenanceVerificationInput,
): Promise<ProvenanceResult> {
    const { expected } = input;
    const failures: string[] = [];
    const audit = runAuditSignatures({
        exec: input.exec,
        installDir: input.installDir,
        ...input.cacheDir === undefined ? {} : { cacheDir: input.cacheDir },
    });
    if (audit.ok) {
        failures.push(...verifyAuditSignatures(audit.report, expected));
    } else {
        failures.push(...audit.failures);
    }
    try {
        const attestations = await fetchAttestations(
            input.fetchJson,
            input.registry,
            expected.packageName,
            expected.packageVersion,
        );
        failures.push(...verifyProvenanceIdentity({ attestations, expected }));
    } catch (error) {
        failures.push(`Attestation download failed: ${errorMessage(error)}`);
    }
    return failures.length > 0 ? { ok: false, failures } : { ok: true };
}
