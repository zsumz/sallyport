import type {
    CandidateReceipt,
    ReleaseRecord,
} from './model.ts';
import type {
    FamilyCandidateReceipt,
    FamilyReleaseRecord,
} from './family-model.ts';

export type ReleaseCandidateReceipt = CandidateReceipt | FamilyCandidateReceipt;
export type ReleaseRecordDocument = ReleaseRecord | FamilyReleaseRecord;
