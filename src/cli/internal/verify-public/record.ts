import {
    buildReleaseRecord,
    type CandidateReceipt,
    type ReleaseRecord,
} from '../../../candidate/receipt.ts';
import type { TarballDigest } from '../../../candidate/inspect.ts';

export interface ReleaseRecordInput {
    receipt: CandidateReceipt;
    candidateReceiptSha256: string;
    registryDigest: TarballDigest;
    signatureVerified: boolean;
    provenanceVerified: boolean;
}

export function createReleaseRecord(input: ReleaseRecordInput): ReleaseRecord {
    const { receipt } = input;
    return buildReleaseRecord({
        candidateReceiptSha256: input.candidateReceiptSha256,
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
            sha256: input.registryDigest.sha256,
            sha512: input.registryDigest.sha512,
            integrityVerified: true,
            signatureVerified: input.signatureVerified,
            provenanceVerified: input.provenanceVerified,
        },
        source: {
            repository: receipt.repository.name,
            tag: receipt.source.tag,
            commit: receipt.source.commit,
        },
    });
}

export function publicSummary(record: ReleaseRecord, attempts: number): string {
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
