import { runAuditSignatures, verifyAuditProof } from './audit.ts';
import { verifyProvenanceBundle } from './identity.ts';
import type {
    ProvenanceResult,
    ProvenanceVerificationInput,
} from './model.ts';

export function verifyRegistryProvenance(
    input: ProvenanceVerificationInput,
): ProvenanceResult {
    const { expected } = input;
    const failures: string[] = [];
    const audit = runAuditSignatures({
        exec: input.exec,
        installDir: input.installDir,
        ...input.cacheDir === undefined ? {} : { cacheDir: input.cacheDir },
    });
    if (audit.ok) {
        const proof = verifyAuditProof(audit.report, expected);
        failures.push(...proof.failures);
        if (proof.provenanceBundle !== null) {
            failures.push(...verifyProvenanceBundle({
                bundle: proof.provenanceBundle,
                expected,
            }));
        }
    } else {
        failures.push(...audit.failures);
    }
    return failures.length > 0 ? { ok: false, failures } : { ok: true };
}
