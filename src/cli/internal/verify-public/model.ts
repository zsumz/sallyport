export const RELEASE_RECORD_FILENAME = 'release.json';
export const PUBLIC_TARBALL_FILENAME = 'public-package.tgz';
export const PROVENANCE_DIRECTORY = 'provenance';

export interface ProvenanceOutcome {
    signatureVerified: boolean;
    provenanceVerified: boolean;
    failures: string[];
}
