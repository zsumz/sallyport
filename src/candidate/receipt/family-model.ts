export const FAMILY_PROTOCOL = 'sallyport/0.2';
export const FAMILY_SCHEMA_VERSION = 2;

export interface FamilyCandidatePackage {
    directory: string;
    name: string;
    version: string;
    access: 'public';
    distTag: string;
    tarball: {
        filename: string;
        bytes: number;
        sha256: string;
        sha512: string;
        integrity: string;
    };
}

export interface FamilyCandidateReceipt {
    schema: 2;
    protocol: 'sallyport/0.2';
    sallyport: {
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
        tagObject: string;
        commit: string;
        signed: boolean;
        signerFingerprint: string | null;
    };
    family: {
        name: string;
        version: string;
        distTag: string;
    };
    packages: FamilyCandidatePackage[];
    run: {
        id: number;
        attempt: number;
    };
}

export interface FamilyReleasePackage {
    name: string;
    version: string;
    distTag: string;
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
}

export interface FamilyReleaseRecord {
    schema: 2;
    protocol: 'sallyport/0.2';
    candidateReceiptSha256: string;
    releaseNotesSha256: string;
    family: FamilyCandidateReceipt['family'];
    packages: FamilyReleasePackage[];
    source: {
        repository: string;
        tag: string;
        commit: string;
    };
}

export interface FamilyCandidateReceiptParts {
    sallyport: FamilyCandidateReceipt['sallyport'];
    repository: FamilyCandidateReceipt['repository'];
    source: FamilyCandidateReceipt['source'];
    family: FamilyCandidateReceipt['family'];
    packages: Array<Omit<FamilyCandidatePackage, 'access'>>;
    run: FamilyCandidateReceipt['run'];
}

export interface FamilyReleaseRecordParts {
    candidateReceiptSha256: string;
    releaseNotesSha256: string;
    family: FamilyReleaseRecord['family'];
    packages: FamilyReleasePackage[];
    source: FamilyReleaseRecord['source'];
}

export function candidateTarballFilename(index: number, count: number): string {
    return count === 1 ? 'package.tgz' : 'package-' + String(index + 1) + '.tgz';
}

export function isFamilyCandidateReceipt(value: unknown): value is FamilyCandidateReceipt {
    return typeof value === 'object' && value !== null
        && 'protocol' in value && value.protocol === FAMILY_PROTOCOL;
}

export function isFamilyReleaseRecord(value: unknown): value is FamilyReleaseRecord {
    return typeof value === 'object' && value !== null
        && 'protocol' in value && value.protocol === FAMILY_PROTOCOL;
}
