import type { Profile } from '../../template.ts';

export type InspectMode = 'stage' | 'finalize';

export const INSPECT_SOURCE_FLAGS = [
    'consumer',
    'profile',
    'tag',
    'repository',
    'repository-id',
    'default-branch',
    'signer-fingerprint',
    'mode',
] as const;

export interface RegistryLookupResult {
    present: boolean;
    failures: string[];
}

export interface SummaryInput {
    name: string;
    version: string;
    tag: string;
    distTag: string;
    profile: Profile;
    mode: InspectMode;
    repository: string;
    repositoryId: number;
    fingerprint: string | null;
}
