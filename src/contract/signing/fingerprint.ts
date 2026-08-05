const FINGERPRINT_PATTERN = /^[0-9a-f]{40}$/iu;
const GOOD_SIGNATURE_PREFIX = '[GNUPG:] GOODSIG ';
const VALID_SIGNATURE_PREFIX = '[GNUPG:] VALIDSIG ';

export function normalizeFingerprint(input: string): string | null {
    const compact = input.replace(/[\s:]/gu, '').replace(/^0x/iu, '');
    return FINGERPRINT_PATTERN.test(compact) ? compact.toUpperCase() : null;
}

export function signatureFailures(
    tag: string,
    output: string,
    expected: string | null,
): string[] {
    const failures: string[] = [];
    const lines = output.split('\n').map((line) => line.trim());
    if (!lines.some((line) => line.startsWith(GOOD_SIGNATURE_PREFIX))) {
        failures.push(`${tag} must carry a good OpenPGP signature.`);
    }
    const validSignature = lines.find(
        (line) => line.startsWith(VALID_SIGNATURE_PREFIX),
    );
    if (validSignature === undefined) {
        failures.push(`${tag} must be signed by a currently valid key.`);
        return failures;
    }
    const fields = validSignature
        .slice(VALID_SIGNATURE_PREFIX.length)
        .trim()
        .split(/\s+/u);
    const primaryKey = normalizeFingerprint(fields.at(-1) ?? '');
    if (primaryKey === null) {
        failures.push(`${tag} must report a primary key fingerprint.`);
    } else if (expected !== null && primaryKey !== expected) {
        failures.push(`${tag} must be signed by ${expected}, found ${primaryKey}.`);
    }
    return failures;
}
