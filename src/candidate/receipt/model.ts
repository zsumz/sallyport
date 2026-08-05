export const PROTOCOL = 'quoin/0.1';
export const RECEIPT_SCHEMA_VERSION = 1;
export const CANDIDATE_TARBALL_FILENAME = 'package.tgz';

export interface CandidateReceipt {
    schema: number;
    protocol: string;
    quoin: {
        version: string;
        workflow: string;
        sha: string;
    };
    repository: {
        name: string;
        id: number;
        defaultBranch: string;
    };
    source: {
        tag: string;
        commit: string;
        signed: boolean;
        signerFingerprint: string | null;
    };
    package: {
        name: string;
        version: string;
        access: 'public';
        distTag: string;
    };
    tarball: {
        filename: string;
        bytes: number;
        sha256: string;
        sha512: string;
        integrity: string;
    };
    run: {
        id: number;
        attempt: number;
    };
}

export interface ReleaseRecord {
    schema: number;
    protocol: string;
    candidateReceiptSha256: string;
    package: {
        name: string;
        version: string;
        distTag: string;
    };
    candidate: {
        sha256: string;
        sha512: string;
    };
    registry: {
        sha256: string;
        sha512: string;
        integrityVerified: boolean;
        signatureVerified: boolean;
        provenanceVerified: boolean;
    };
    source: {
        repository: string;
        tag: string;
        commit: string;
    };
}

export interface CandidateReceiptParts {
    quoin: CandidateReceipt['quoin'];
    repository: CandidateReceipt['repository'];
    source: CandidateReceipt['source'];
    package: Omit<CandidateReceipt['package'], 'access'>;
    tarball: Omit<CandidateReceipt['tarball'], 'filename'>;
    run: CandidateReceipt['run'];
}

export interface ReleaseRecordParts {
    candidateReceiptSha256: string;
    package: ReleaseRecord['package'];
    candidate: ReleaseRecord['candidate'];
    registry: ReleaseRecord['registry'];
    source: ReleaseRecord['source'];
}
