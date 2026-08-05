import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CandidateReceipt } from '../../../candidate/receipt.ts';
import {
    runAuditSignatures,
    verifyAuditProof,
    verifyProvenanceBundle,
    type ExpectedProvenance,
} from '../../../registry/provenance.ts';
import { ensureDirectory, errorMessage, jsonDocument } from '../../support.ts';
import type { CliEffects } from '../effects.ts';
import { PROVENANCE_DIRECTORY, type ProvenanceOutcome } from './model.ts';

// npm's audit both verifies the bundle and returns the exact verified bytes.
// Identity is parsed only from that cryptographically bound proof.
export async function verifyProvenance(
    effects: CliEffects,
    outputDir: string,
    receipt: CandidateReceipt,
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
    const proof = audit.ok
        ? verifyAuditProof(audit.report, expected)
        : { failures: audit.failures, provenanceBundle: null };
    const provenanceFailures = proof.provenanceBundle === null
        ? []
        : verifyProvenanceBundle({ bundle: proof.provenanceBundle, expected });
    return {
        signatureVerified: proof.failures.length === 0,
        provenanceVerified: proof.failures.length === 0
            && proof.provenanceBundle !== null
            && provenanceFailures.length === 0,
        failures: [...proof.failures, ...provenanceFailures],
    };
}
