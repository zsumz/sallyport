import path from 'node:path';

import { normalizeFingerprint } from '../../contract/signing.ts';
import { result, SIGNING_KEY_FILE, type CheckOptions, type CheckResult } from './model.ts';
import { readRemoteJson, readRemoteText } from './remote-command.ts';
import { booleanProperty, stringProperty } from './remote-shape.ts';
import type { RemoteTarget } from './remote-target.ts';

const SIGNER_VARIABLE = 'SALLYPORT_SIGNER_FINGERPRINT';

export function immutableReleaseCheck(
    target: RemoteTarget,
    options: CheckOptions,
): CheckResult {
    const id = 'remote-immutable-releases';
    const read = readRemoteJson(options, 'gh', [
        'api', `repos/${target.repository}/immutable-releases`,
    ]);
    if (!read.ok) {
        return result(id, 'unverified', read.message);
    }
    const enabled = booleanProperty(read.value, 'enabled');
    if (enabled === null) {
        return result(id, 'unverified', 'GitHub returned no immutable Releases setting.');
    }
    return enabled
        ? result(id, 'pass', 'immutable Releases are enabled.')
        : result(id, 'fail', 'immutable Releases must be enabled.');
}

export function signerVariableCheck(
    target: RemoteTarget,
    options: CheckOptions,
): CheckResult {
    const id = 'remote-signer-variable';
    if (target.profile !== 'strict') {
        return result(id, 'skip', 'the standard profile does not require signed tags.');
    }
    const read = readRemoteJson(options, 'gh', [
        'api', `repos/${target.repository}/actions/variables/${SIGNER_VARIABLE}`,
    ]);
    if (!read.ok) {
        return result(id, 'unverified', read.message);
    }
    const configured = normalizeFingerprint(stringProperty(read.value, 'value') ?? '');
    if (configured === null) {
        return result(id, 'fail', `${SIGNER_VARIABLE} must be a 40-hex fingerprint.`);
    }
    const local = publicKeyFingerprint(target, options);
    if (!local.ok) {
        return result(id, 'unverified', local.message);
    }
    return local.value === configured
        ? result(id, 'pass', `${SIGNER_VARIABLE} matches ${SIGNING_KEY_FILE}.`)
        : result(id, 'fail', `${SIGNER_VARIABLE} does not match ${SIGNING_KEY_FILE}.`);
}

function publicKeyFingerprint(
    target: RemoteTarget,
    options: CheckOptions,
): { ok: true; value: string } | { ok: false; message: string } {
    const read = readRemoteText(options, 'gpg', [
        '--batch',
        '--with-colons',
        '--import-options', 'show-only',
        '--import', path.join(target.dir, SIGNING_KEY_FILE),
    ]);
    if (!read.ok) {
        return read;
    }
    const fingerprint = read.value.split('\n')
        .find((line) => line.startsWith('fpr:'))
        ?.split(':')[9];
    const normalized = normalizeFingerprint(fingerprint ?? '');
    return normalized === null
        ? { ok: false, message: `${SIGNING_KEY_FILE} has no readable primary fingerprint.` }
        : { ok: true, value: normalized };
}
