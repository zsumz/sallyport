import {
    CANDIDATE_RECEIPT_NAME,
    CANDIDATE_TARBALL_NAME,
} from '../../../github/artifacts.ts';

export const RELEASE_NOTES_FILENAME = 'RELEASE_NOTES.md';
export const RELEASE_RECORD_FILENAME = 'release.json';
export const CHECKSUM_FILENAME = 'SHA256SUMS';

// SHA256SUMS covers every other bundle file; a checksum file cannot list itself.
export const CHECKSUM_MEMBERS = [
    CANDIDATE_TARBALL_NAME,
    CANDIDATE_RECEIPT_NAME,
    RELEASE_RECORD_FILENAME,
    RELEASE_NOTES_FILENAME,
] as const;

export interface BundleBytes {
    tarball: Buffer;
    receipt: Buffer;
    release: Buffer;
    notes: Buffer;
}
