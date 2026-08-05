// The receipt always names the reusable workflow without a ref; the pinned
// commit is recorded separately as quoin.sha.
export const STAGE_WORKFLOW_REFERENCE = 'zsumz/quoin/.github/workflows/stage.yml';
export const CANDIDATE_RECEIPT_FILENAME = 'candidate.json';

export const CREATE_CANDIDATE_FLAGS = [
    'consumer',
    'tarball',
    'output',
    'profile',
    'tag',
    'repository',
    'repository-id',
    'default-branch',
    'commit',
    'signed',
    'signer-fingerprint',
    'run-id',
    'run-attempt',
    'quoin-sha',
] as const;
