import {
    normalizeFingerprint,
    verifySignedTag,
} from '../../../contract/signing.ts';
import type { CliEffects } from '../effects.ts';
import type { InspectMode } from './model.ts';

export function parseMode(value: string | undefined): InspectMode {
    if (value === undefined || value === '') {
        return 'stage';
    }
    if (value !== 'stage' && value !== 'finalize') {
        throw new Error(`Source inspection failed: --mode must be stage or finalize, found ${value}.`);
    }
    return value;
}

export function requestedFingerprint(value: string | undefined): string | null {
    return value === undefined ? null : normalizeFingerprint(value);
}

export function strictFailures(
    effects: CliEffects,
    consumerDir: string,
    tag: string,
    fingerprint: string | null,
): string[] {
    if (fingerprint === null) {
        return [
            'the strict profile requires a 40-hexadecimal signer fingerprint in'
            + ' SALLYPORT_SIGNER_FINGERPRINT.',
        ];
    }
    const signature = verifySignedTag({
        tag,
        expectedFingerprint: fingerprint,
        cwd: consumerDir,
        exec: effects.exec,
    });
    return signature.ok ? [] : signature.failures;
}
