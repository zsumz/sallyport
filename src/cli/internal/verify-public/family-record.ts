import {
    buildFamilyReleaseRecord,
    type FamilyCandidateReceipt,
    type FamilyReleasePackage,
    type FamilyReleaseRecord,
} from '../../../candidate/receipt.ts';

export interface FamilyRecordInput {
    receipt: FamilyCandidateReceipt;
    candidateReceiptSha256: string;
    releaseNotesSha256: string;
    packages: FamilyReleasePackage[];
}

export function createFamilyReleaseRecord(input: FamilyRecordInput): FamilyReleaseRecord {
    return buildFamilyReleaseRecord({
        candidateReceiptSha256: input.candidateReceiptSha256,
        releaseNotesSha256: input.releaseNotesSha256,
        family: input.receipt.family,
        packages: input.packages,
        source: {
            repository: input.receipt.repository.name,
            tag: input.receipt.source.tag,
            commit: input.receipt.source.commit,
        },
    });
}

export function familyPublicSummary(
    record: FamilyReleaseRecord,
    attempts: readonly number[],
): string {
    const rows = record.packages.map((member, index) =>
        '| ' + member.name + '@' + member.version
        + ' | ' + member.registry.sha256
        + ' | ' + String(attempts[index] ?? 0) + ' |');
    return [
        '### sallyport package-family public verification',
        '',
        '| Package | Public SHA-256 | Convergence attempts |',
        '| --- | --- | --- |',
        ...rows,
        '',
        'Registry signatures and provenance verified for all '
            + String(record.packages.length) + ' packages.',
        '',
    ].join('\n');
}
