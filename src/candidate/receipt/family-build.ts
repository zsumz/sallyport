import {
    FAMILY_PROTOCOL,
    FAMILY_SCHEMA_VERSION,
    type FamilyCandidateReceipt,
    type FamilyCandidateReceiptParts,
    type FamilyReleaseRecord,
    type FamilyReleaseRecordParts,
} from './family-model.ts';
import {
    validateFamilyCandidateReceipt,
    validateFamilyReleaseRecord,
} from './validate-family.ts';

export function buildFamilyCandidateReceipt(
    parts: FamilyCandidateReceiptParts,
): FamilyCandidateReceipt {
    const receipt: FamilyCandidateReceipt = {
        schema: FAMILY_SCHEMA_VERSION,
        protocol: FAMILY_PROTOCOL,
        sallyport: { ...parts.sallyport },
        repository: { ...parts.repository },
        source: { ...parts.source },
        family: { ...parts.family },
        packages: parts.packages.map((member) => ({
            directory: member.directory,
            name: member.name,
            version: member.version,
            access: 'public',
            distTag: member.distTag,
            tarball: { ...member.tarball },
        })),
        run: { ...parts.run },
    };
    const failures = validateFamilyCandidateReceipt(receipt);
    if (failures.length > 0) {
        throw new Error('Family candidate receipt is invalid:\n' + failures.join('\n'));
    }
    return receipt;
}

export function buildFamilyReleaseRecord(
    parts: FamilyReleaseRecordParts,
): FamilyReleaseRecord {
    const record: FamilyReleaseRecord = {
        schema: FAMILY_SCHEMA_VERSION,
        protocol: FAMILY_PROTOCOL,
        candidateReceiptSha256: parts.candidateReceiptSha256,
        releaseNotesSha256: parts.releaseNotesSha256,
        family: { ...parts.family },
        packages: parts.packages.map((member) => ({
            name: member.name,
            version: member.version,
            distTag: member.distTag,
            candidate: { ...member.candidate },
            registry: { ...member.registry },
        })),
        source: { ...parts.source },
    };
    const failures = validateFamilyReleaseRecord(record);
    if (failures.length > 0) {
        throw new Error('Family release record is invalid:\n' + failures.join('\n'));
    }
    return record;
}
