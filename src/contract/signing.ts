export { normalizeFingerprint } from './signing/fingerprint.ts';
export type {
    CommandRunner,
    SignedTagRequest,
    TagCommitRequest,
    TagReachabilityRequest,
    VerificationResult,
} from './signing/model.ts';
export {
    verifySignedTag,
    verifyTagCommit,
    verifyTagReachableFromBranch,
} from './signing/tag.ts';
