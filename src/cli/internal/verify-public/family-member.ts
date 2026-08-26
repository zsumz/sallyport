import { inspectCandidateTarball } from '../../../candidate/inspect.ts';
import type {
    FamilyCandidatePackage,
    FamilyCandidateReceipt,
    FamilyReleasePackage,
} from '../../../candidate/receipt.ts';
import { CALLER_WORKFLOW_PATH } from '../../../github/workflow-run.ts';
import {
    awaitRegistryConvergence,
    downloadTarball,
    type RegistryCandidate,
} from '../../../registry/download.ts';
import { compareRegistryIntegrity, type PackedManifest } from '../../../registry/integrity.ts';
import type { ExpectedProvenance } from '../../../registry/provenance.ts';
import type { CliEffects } from '../effects.ts';
import { convergedVersionMeta } from './entry.ts';
import { verifyProvenance } from './provenance.ts';

export interface FamilyMemberInput {
    receipt: FamilyCandidateReceipt;
    member: FamilyCandidatePackage;
    outputDir: string;
    registry: string;
    effects: CliEffects;
}

export interface FamilyMemberOutcome {
    record: FamilyReleasePackage | null;
    publicTarball: Buffer | null;
    attempts: number;
    failures: string[];
}

export async function verifyFamilyMember(
    input: FamilyMemberInput,
): Promise<FamilyMemberOutcome> {
    const candidate: RegistryCandidate = {
        package: input.member,
        tarball: input.member.tarball,
    };
    const convergence = await awaitRegistryConvergence({
        fetch: input.effects.registry,
        candidate,
        sleep: input.effects.sleep,
        registry: input.registry,
    });
    const versionMeta = convergedVersionMeta(convergence);
    const publicTarball = Buffer.from(
        await downloadTarball(input.effects.registry.fetchBuffer, versionMeta.tarball),
    );
    const inspection = inspectCandidateTarball(publicTarball);
    const packedManifest: PackedManifest | null =
        inspection.name === null || inspection.version === null
            ? null
            : { name: inspection.name, version: inspection.version };
    const comparison = compareRegistryIntegrity({
        receipt: candidate,
        versionMeta,
        publicTarball,
        packedManifest,
    });
    const expected = expectedProvenance(input.receipt, input.member);
    const provenance = await verifyProvenance(
        input.effects,
        input.outputDir,
        candidate,
        expected,
    );
    const failures = [...inspection.failures, ...provenance.failures];
    if (!comparison.ok) failures.push(...comparison.failures);
    if (failures.length > 0) {
        return { record: null, publicTarball: null, attempts: convergence.attempts, failures };
    }
    return {
        record: {
            name: input.member.name,
            version: input.member.version,
            distTag: input.member.distTag,
            candidate: {
                sha256: input.member.tarball.sha256,
                sha512: input.member.tarball.sha512,
            },
            registry: {
                sha256: comparison.digest.sha256,
                sha512: comparison.digest.sha512,
                integrityVerified: true,
                signatureVerified: provenance.signatureVerified,
                provenanceVerified: provenance.provenanceVerified,
            },
        },
        publicTarball,
        attempts: convergence.attempts,
        failures: [],
    };
}

function expectedProvenance(
    receipt: FamilyCandidateReceipt,
    member: FamilyCandidatePackage,
): ExpectedProvenance {
    return {
        packageName: member.name,
        packageVersion: member.version,
        repository: receipt.repository.name,
        repositoryId: receipt.repository.id,
        workflowPath: CALLER_WORKFLOW_PATH,
        builderWorkflow: receipt.sallyport.workflow,
        builderSha: receipt.sallyport.sha,
        tagRef: receipt.source.tag,
        sourceCommit: receipt.source.commit,
        tarballSha512: member.tarball.sha512,
        runId: receipt.run.id,
        runAttempt: receipt.run.attempt,
    };
}
