import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashTarball, inspectCandidateTarball } from '../../candidate/inspect.ts';
import {
    buildReleaseRecord,
    type CandidateReceipt,
    type ReleaseRecord,
} from '../../candidate/receipt.ts';
import { normalizeFingerprint } from '../../contract/signing.ts';
import {
    CANDIDATE_RECEIPT_NAME,
    CANDIDATE_TARBALL_NAME,
} from '../../github/artifacts.ts';
import { CALLER_WORKFLOW_PATH } from '../../github/workflow-run.ts';
import {
    awaitRegistryConvergence,
    DEFAULT_REGISTRY,
    downloadTarball,
    type RegistryConvergence,
    type RegistryVersionMeta,
} from '../../registry/download.ts';
import {
    compareRegistryIntegrity,
    sha256Hex,
    type PackedManifest,
} from '../../registry/integrity.ts';
import {
    fetchAttestations,
    runAuditSignatures,
    verifyAuditSignatures,
    verifyProvenanceIdentity,
    type ExpectedProvenance,
} from '../../registry/provenance.ts';
import { optionalValue, parseArgv, requireValue } from '../args.ts';
import { ensureDirectory, errorMessage, failure, jsonDocument } from '../support.ts';
import { parseProfile, type Profile } from '../template.ts';
import type { CliEffects } from './effects.ts';
import { parseReceipt } from './fetch-candidate.ts';
import { PUBLIC_SMOKE_DIRECTORY, runReleaseSmoke, smokeDirectory } from './smoke.ts';

export const RELEASE_RECORD_FILENAME = 'release.json';
export const PUBLIC_TARBALL_FILENAME = 'public-package.tgz';
export const PROVENANCE_DIRECTORY = 'provenance';

interface ProvenanceOutcome {
    signatureVerified: boolean;
    provenanceVerified: boolean;
    failures: string[];
}

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

    const record = buildReleaseRecord({
        candidateReceiptSha256: sha256Hex(receiptBytes),
        package: {
            name: receipt.package.name,
            version: receipt.package.version,
            distTag: receipt.package.distTag,
        },
        candidate: {
            sha256: receipt.tarball.sha256,
            sha512: receipt.tarball.sha512,
        },
        registry: {
            sha256: comparison.digest.sha256,
            sha512: comparison.digest.sha512,
            integrityVerified: true,
            signatureVerified: provenance.signatureVerified,
            provenanceVerified: provenance.provenanceVerified,
        },
        source: {
            repository: receipt.repository.name,
            tag: receipt.source.tag,
            commit: receipt.source.commit,
        },
    });

    const releasePath = path.join(outputDir, RELEASE_RECORD_FILENAME);
    await writeFile(releasePath, jsonDocument(record));
    await writeFile(path.join(outputDir, PUBLIC_TARBALL_FILENAME), Buffer.from(publicTarball));
    await effects.writeOutput({
        release: releasePath,
        public_sha256: comparison.digest.sha256,
    });
    await effects.writeSummary(publicSummary(record, convergence.attempts));
}

function candidateFailures(bytes: Buffer, receipt: CandidateReceipt): string[] {
    const digest = hashTarball(bytes);
    if (digest.sha256 === receipt.tarball.sha256 && digest.sha512 === receipt.tarball.sha512) {
        return [];
    }
    return [
        `the candidate tarball sha256 ${digest.sha256} does not match candidate.json ${receipt.tarball.sha256}.`,
    ];
}

function profileFailures(
    profile: Profile,
    requested: string | undefined,
    receipt: CandidateReceipt,
): string[] {
    if (profile !== 'strict') {
        return [];
    }
    const fingerprint = requested === undefined ? null : normalizeFingerprint(requested);
    const failures: string[] = [];
    if (fingerprint === null) {
        failures.push(
            'the strict profile requires a 40-hexadecimal signer fingerprint in'
            + ' QUOIN_SIGNER_FINGERPRINT.',
        );
    }
    if (!receipt.source.signed) {
        failures.push('candidate.json records an unsigned tag; the strict profile requires a signed tag.');
    } else if (fingerprint !== null && receipt.source.signerFingerprint !== fingerprint) {
        failures.push(
            `candidate.json was signed by ${receipt.source.signerFingerprint ?? 'nobody'}, expected ${fingerprint}.`,
        );
    }
    return failures;
}

function convergedVersionMeta(convergence: RegistryConvergence): RegistryVersionMeta {
    const { state } = convergence;
    if (state.state === 'converged') {
        return state.versionMeta;
    }
    if (state.state === 'mismatch') {
        throw failure('Public verification failed:', state.failures);
    }
    throw failure('Public verification failed:', [
        `the registry did not converge after ${String(convergence.attempts)} attempts: ${state.reason}`,
    ]);
}

// npm's own signature check runs against a throwaway install of the public
// package; the attestation identity check runs against the registry document.
async function verifyProvenance(
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

function publicSummary(record: ReleaseRecord, attempts: number): string {
    return [
        '### quoin public verification',
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| Package | \`${record.package.name}@${record.package.version}\` |`,
        `| Dist-tag | \`${record.package.distTag}\` |`,
        `| Public SHA-256 | \`${record.registry.sha256}\` |`,
        `| Candidate SHA-256 | \`${record.candidate.sha256}\` |`,
        '| Registry signature | verified |',
        '| Provenance | verified |',
        `| Convergence attempts | ${String(attempts)} |`,
        `| Source | \`${record.source.repository}\` \`${record.source.tag}\` \`${record.source.commit}\` |`,
        '',
    ].join('\n');
}
