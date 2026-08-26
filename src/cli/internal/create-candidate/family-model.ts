import type {
    FamilyCandidateReceipt,
} from '../../../candidate/receipt.ts';

export interface CandidateIdentity {
    sallyport: FamilyCandidateReceipt['sallyport'];
    repository: FamilyCandidateReceipt['repository'];
    source: FamilyCandidateReceipt['source'];
    run: FamilyCandidateReceipt['run'];
    distTag: string;
}
