import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CandidateReceipt } from '../../../candidate/receipt.ts';
import {
    fetchAttestations,
    runAuditSignatures,
    verifyAuditSignatures,
    verifyProvenanceIdentity,
    type ExpectedProvenance,
} from '../../../registry/provenance.ts';
import { ensureDirectory, errorMessage, jsonDocument } from '../../support.ts';
import type { CliEffects } from '../effects.ts';
import { PROVENANCE_DIRECTORY, type ProvenanceOutcome } from './model.ts';

// npm's signature check runs against a throwaway install of the public package;
// the identity check runs against the registry attestation document.
export async function verifyProvenance(
    effects: CliEffects,
    outputDir: string,
    receipt: CandidateReceipt,
    registry: string,
    expected: ExpectedProvenance,
): Promise<ProvenanceOutcome> {
    const installDir = path.join(outputDir, PROVENANCE_DIRECTORY);
    const cacheDir = path.join(installDir, '.npm-cache');
    await ensureDirectory(installDir);
    await writeFile(path.join(installDir, 'package.json'), jsonDocument({
        dependencies: { [receipt.package.name]: receipt.package.version },
    }));
    try {
        effects.exec('npm', [
            'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--cache',
            cacheDir,
        ], { cwd: installDir });
    } catch (error) {
        return {
            signatureVerified: false,
            provenanceVerified: false,
            failures: [`installing the public package failed: ${errorMessage(error)}`],
        };
    }
    const audit = runAuditSignatures({ exec: effects.exec, installDir, cacheDir });
    const signatureFailures = audit.ok
        ? verifyAuditSignatures(audit.report, expected)
        : audit.failures;
    let provenanceFailures: string[];
    try {
        const attestations = await fetchAttestations(
            effects.registry.fetchJson,
            registry,
            expected.packageName,
            expected.packageVersion,
        );
        provenanceFailures = verifyProvenanceIdentity({ attestations, expected });
    } catch (error) {
        provenanceFailures = [`attestation download failed: ${errorMessage(error)}`];
    }
    return {
        signatureVerified: signatureFailures.length === 0,
        provenanceVerified: provenanceFailures.length === 0,
        failures: [...signatureFailures, ...provenanceFailures],
    };
}
