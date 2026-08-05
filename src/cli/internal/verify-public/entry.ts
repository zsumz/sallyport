import { hashTarball } from '../../../candidate/inspect.ts';
import type { CandidateReceipt } from '../../../candidate/receipt.ts';
import { normalizeFingerprint } from '../../../contract/signing.ts';
import type {
    RegistryConvergence,
    RegistryVersionMeta,
} from '../../../registry/download.ts';
import { failure } from '../../support.ts';
import type { Profile } from '../../template.ts';

export function candidateFailures(bytes: Buffer, receipt: CandidateReceipt): string[] {
    const digest = hashTarball(bytes);
    if (digest.sha256 === receipt.tarball.sha256 && digest.sha512 === receipt.tarball.sha512) {
        return [];
    }
    return [
        `the candidate tarball sha256 ${digest.sha256} does not match candidate.json ${receipt.tarball.sha256}.`,
    ];
}

export function profileFailures(
    profile: Profile,
    requested: string | undefined,
    receipt: CandidateReceipt,
): string[] {
    if (profile !== 'strict') {
        return [];
    }
    const fingerprint = requested === undefined ? null : normalizeFingerprint(requested);
    const failures: string[] = [];
    if (fingerprint === null) {
        failures.push(
            'the strict profile requires a 40-hexadecimal signer fingerprint in'
            + ' SALLYPORT_SIGNER_FINGERPRINT.',
        );
    }
    if (!receipt.source.signed) {
        failures.push('candidate.json records an unsigned tag; the strict profile requires a signed tag.');
    } else if (fingerprint !== null && receipt.source.signerFingerprint !== fingerprint) {
        failures.push(
            `candidate.json was signed by ${receipt.source.signerFingerprint ?? 'nobody'}, expected ${fingerprint}.`,
        );
    }
    return failures;
}

export function convergedVersionMeta(convergence: RegistryConvergence): RegistryVersionMeta {
    const { state } = convergence;
    if (state.state === 'converged') {
        return state.versionMeta;
    }
    if (state.state === 'mismatch') {
        throw failure('Public verification failed:', state.failures);
    }
    throw failure('Public verification failed:', [
        `the registry did not converge after ${String(convergence.attempts)} attempts: ${state.reason}`,
    ]);
}
