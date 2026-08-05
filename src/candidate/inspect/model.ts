export const CANDIDATE_ROOT_DIRECTORY = 'package';
export const CANDIDATE_MANIFEST_PATH = `${CANDIDATE_ROOT_DIRECTORY}/package.json`;

export type TarEntryType = 'file' | 'directory' | 'other';

export interface TarEntry {
    path: string;
    type: TarEntryType;
    size: number;
}

export interface CandidateTarballInspection {
    name: string | null;
    version: string | null;
    files: TarEntry[];
    failures: string[];
}

export interface CandidateTarballManifest {
    name: string;
    version: string;
    files: TarEntry[];
}

export interface TarballDigest {
    bytes: number;
    sha256: string;
    sha512: string;
    integrity: string;
}

export interface VerifyTarballUnchangedInput {
    before: TarballDigest;
    afterBuffer: Buffer;
}

export interface TarballUnchangedResult {
    unchanged: boolean;
    after: TarballDigest;
    failures: string[];
}
