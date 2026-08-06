export { normalizeFingerprint } from './signing/fingerprint.ts';
export type {
    CommandRunner,
    SignedTagRequest,
    TagCommitRequest,
    TagObjectRequest,
    TagReachabilityRequest,
    VerificationResult,
} from './signing/model.ts';
export {
    resolveTagObject,
    verifySignedTag,
    verifyTagCommit,
    verifyTagReachableFromBranch,
} from './signing/tag.ts';
