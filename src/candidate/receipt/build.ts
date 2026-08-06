import {
    CANDIDATE_TARBALL_FILENAME,
    PROTOCOL,
    RECEIPT_SCHEMA_VERSION,
    type CandidateReceipt,
    type CandidateReceiptParts,
    type ReleaseRecord,
    type ReleaseRecordParts,
} from './model.ts';
import { validateCandidateReceipt } from './validate-candidate.ts';
import { validateReleaseRecord } from './validate-release.ts';

// Release metadata is derived, never supplied: access, filename, schema and protocol are fixed.
export function buildCandidateReceipt(parts: CandidateReceiptParts): CandidateReceipt {
    const receipt: CandidateReceipt = {
        schema: RECEIPT_SCHEMA_VERSION,
        protocol: PROTOCOL,
        sallyport: {
            version: parts.sallyport.version,
            workflow: parts.sallyport.workflow,
            sha: parts.sallyport.sha,
        },
        repository: {
            name: parts.repository.name,
            id: parts.repository.id,
            defaultBranch: parts.repository.defaultBranch,
        },
        source: {
            tag: parts.source.tag,
            tagObject: parts.source.tagObject,
            commit: parts.source.commit,
            signed: parts.source.signed,
            signerFingerprint: parts.source.signerFingerprint,
        },
        package: {
            name: parts.package.name,
            version: parts.package.version,
            access: 'public',
            distTag: parts.package.distTag,
        },
        tarball: {
            filename: CANDIDATE_TARBALL_FILENAME,
            bytes: parts.tarball.bytes,
            sha256: parts.tarball.sha256,
            sha512: parts.tarball.sha512,
            integrity: parts.tarball.integrity,
        },
        run: {
            id: parts.run.id,
            attempt: parts.run.attempt,
        },
    };
    const failures = validateCandidateReceipt(receipt);
    if (failures.length > 0) {
        throw new Error(`Candidate receipt is invalid:\n${failures.join('\n')}`);
    }
    return receipt;
}

export function buildReleaseRecord(parts: ReleaseRecordParts): ReleaseRecord {
    const record: ReleaseRecord = {
        schema: RECEIPT_SCHEMA_VERSION,
        protocol: PROTOCOL,
        candidateReceiptSha256: parts.candidateReceiptSha256,
        releaseNotesSha256: parts.releaseNotesSha256,
        package: {
            name: parts.package.name,
            version: parts.package.version,
            distTag: parts.package.distTag,
        },
        candidate: {
            sha256: parts.candidate.sha256,
            sha512: parts.candidate.sha512,
        },
        registry: {
            sha256: parts.registry.sha256,
            sha512: parts.registry.sha512,
            integrityVerified: parts.registry.integrityVerified,
            signatureVerified: parts.registry.signatureVerified,
            provenanceVerified: parts.registry.provenanceVerified,
        },
        source: {
            repository: parts.source.repository,
            tag: parts.source.tag,
            commit: parts.source.commit,
        },
    };
    const failures = validateReleaseRecord(record);
    if (failures.length > 0) {
        throw new Error(`Release record is invalid:\n${failures.join('\n')}`);
    }
    return record;
}
