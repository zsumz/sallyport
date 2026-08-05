import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { inspectCandidateTarball } from '../../../candidate/inspect.ts';
import {
    CANDIDATE_RECEIPT_NAME,
    CANDIDATE_TARBALL_NAME,
} from '../../../github/artifacts.ts';
import { CALLER_WORKFLOW_PATH } from '../../../github/workflow-run.ts';
import {
    awaitRegistryConvergence,
    DEFAULT_REGISTRY,
    downloadTarball,
} from '../../../registry/download.ts';
import { compareRegistryIntegrity, sha256Hex, type PackedManifest } from '../../../registry/integrity.ts';
import type { ExpectedProvenance } from '../../../registry/provenance.ts';
import { optionalValue, parseArgv, requireValue } from '../../args.ts';
import { ensureDirectory, failure, jsonDocument } from '../../support.ts';
import { parseProfile } from '../../template.ts';
import type { CliEffects } from '../effects.ts';
import { parseReceipt } from '../fetch-candidate.ts';
import { PUBLIC_SMOKE_DIRECTORY, runReleaseSmoke, smokeDirectory } from '../smoke.ts';
import { candidateFailures, convergedVersionMeta, profileFailures } from './entry.ts';
import { PUBLIC_TARBALL_FILENAME, RELEASE_RECORD_FILENAME } from './model.ts';
import { verifyProvenance } from './provenance.ts';
import { createReleaseRecord, publicSummary } from './record.ts';

export async function verifyPublicCommand(
    argv: readonly string[],
    effects: CliEffects,
): Promise<void> {
    const parsed = parseArgv(argv, {
        strings: ['consumer', 'candidate-dir', 'output', 'profile', 'signer-fingerprint'],
    });
    const consumerDir = path.resolve(requireValue(parsed, 'consumer'));
    const candidateDir = path.resolve(requireValue(parsed, 'candidate-dir'));
    const outputDir = path.resolve(requireValue(parsed, 'output'));
    const profile = parseProfile(optionalValue(parsed, 'profile') ?? 'standard');
    const requestedFingerprint = optionalValue(parsed, 'signer-fingerprint');

    await ensureDirectory(outputDir);
    const receiptBytes = await readFile(path.join(candidateDir, CANDIDATE_RECEIPT_NAME));
    const receipt = parseReceipt(receiptBytes);
    const candidateBytes = await readFile(path.join(candidateDir, CANDIDATE_TARBALL_NAME));
    const entryFailures = [
        ...candidateFailures(candidateBytes, receipt),
        ...profileFailures(profile, requestedFingerprint, receipt),
    ];
    if (entryFailures.length > 0) {
        throw failure('Public verification failed:', entryFailures);
    }

    const registry = effects.env.NPM_CONFIG_REGISTRY ?? DEFAULT_REGISTRY;
    const convergence = await awaitRegistryConvergence({
        fetch: effects.registry,
        candidate: receipt,
        sleep: effects.sleep,
        registry,
    });
    const versionMeta = convergedVersionMeta(convergence);
    const publicTarball = await downloadTarball(effects.registry.fetchBuffer, versionMeta.tarball);
    const inspection = inspectCandidateTarball(Buffer.from(publicTarball));
    const packedManifest: PackedManifest | null = inspection.name === null || inspection.version === null
        ? null
        : { name: inspection.name, version: inspection.version };
    const comparison = compareRegistryIntegrity({
        receipt,
        versionMeta,
        publicTarball,
        packedManifest,
    });
    const byteFailures = [...inspection.failures];
    if (!comparison.ok) {
        byteFailures.push(...comparison.failures);
    }
    if (byteFailures.length > 0) {
        throw failure('Public verification failed:', byteFailures);
    }

    const expected: ExpectedProvenance = {
        packageName: receipt.package.name,
        packageVersion: receipt.package.version,
        repository: receipt.repository.name,
        workflowPath: CALLER_WORKFLOW_PATH,
        tagRef: receipt.source.tag,
        tarballSha512: receipt.tarball.sha512,
        runId: receipt.run.id,
    };
    const provenance = await verifyProvenance(effects, outputDir, receipt, registry, expected);
    const smoke = await runReleaseSmoke({
        consumerDir,
        tarball: Buffer.from(publicTarball),
        directory: smokeDirectory(effects, PUBLIC_SMOKE_DIRECTORY),
        packageName: receipt.package.name,
        version: receipt.package.version,
        distTag: receipt.package.distTag,
        effects,
    });
    const failures = [...provenance.failures, ...smoke.failures];
    if (failures.length > 0) {
        throw failure('Public verification failed:', failures);
    }

    const record = createReleaseRecord({
        receipt,
        candidateReceiptSha256: sha256Hex(receiptBytes),
        registryDigest: comparison.digest,
        signatureVerified: provenance.signatureVerified,
        provenanceVerified: provenance.provenanceVerified,
    });
    const releasePath = path.join(outputDir, RELEASE_RECORD_FILENAME);
    await writeFile(releasePath, jsonDocument(record));
    await writeFile(path.join(outputDir, PUBLIC_TARBALL_FILENAME), Buffer.from(publicTarball));
    await effects.writeOutput({ release: releasePath, public_sha256: comparison.digest.sha256 });
    await effects.writeSummary(publicSummary(record, convergence.attempts));
}
