import type { CommandOptions, CommandResult } from '../report/exec.ts';

export type CommandRunner = (
    command: string,
    args: readonly string[],
    options: CommandOptions,
) => CommandResult;

export interface SignedTagRequest {
    tag: string;
    expectedFingerprint: string;
    cwd: string;
    exec: CommandRunner;
}

export interface TagReachabilityRequest {
    tag: string;
    branch: string;
    cwd: string;
    exec: CommandRunner;
}

export type VerificationResult =
    | { ok: true }
    | { ok: false; failures: string[] };

const FINGERPRINT_PATTERN = /^[0-9a-f]{40}$/iu;
const GOOD_SIGNATURE_PREFIX = '[GNUPG:] GOODSIG ';
const VALID_SIGNATURE_PREFIX = '[GNUPG:] VALIDSIG ';

export function normalizeFingerprint(input: string): string | null {
    const compact = input.replace(/[\s:]/gu, '').replace(/^0x/iu, '');
    return FINGERPRINT_PATTERN.test(compact) ? compact.toUpperCase() : null;
}

export function verifySignedTag(request: SignedTagRequest): VerificationResult {
    const { tag } = request;
    const failures: string[] = [];
    const expected = normalizeFingerprint(request.expectedFingerprint);
    if (expected === null) {
        failures.push(
            'the expected signer fingerprint must be 40 hexadecimal characters.',
        );
    }
    const tagType = gitOutput(request.exec, request.cwd, [
        'cat-file',
        '-t',
        `refs/tags/${tag}`,
    ])?.trim();
    if (tagType !== 'tag') {
        failures.push(`${tag} must be an annotated tag.`);
    }
    const signature = gitOutput(request.exec, request.cwd, [
        'verify-tag',
        '--raw',
        tag,
    ]);
    if (signature === null) {
        failures.push(`${tag} must carry a good OpenPGP signature.`);
    } else {
        failures.push(...signatureFailures(tag, signature, expected));
    }
    return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

export function verifyTagReachableFromBranch(
    request: TagReachabilityRequest,
): VerificationResult {
    const { branch, tag } = request;
    const commit = gitOutput(request.exec, request.cwd, [
        'rev-list',
        '-n',
        '1',
        tag,
    ]);
    if (commit === null || commit.trim() === '') {
        return { ok: false, failures: [`${tag} must resolve to a commit.`] };
    }
    const reachable = gitOutput(request.exec, request.cwd, [
        'merge-base',
        '--is-ancestor',
        commit.trim(),
        branch,
    ]);
    return reachable === null
        ? {
            ok: false,
            failures: [
                `${tag} must point to a commit reachable from ${branch}.`,
            ],
        }
        : { ok: true };
}

function signatureFailures(
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

// git exits nonzero for missing refs and bad signatures; the injected runner
// throws in that case, which is always a verification failure.
function gitOutput(
    exec: CommandRunner,
    cwd: string,
    args: readonly string[],
): string | null {
    try {
        const result = exec('git', args, { cwd });
        return `${result.stdout}\n${result.stderr}`;
    } catch {
        return null;
    }
}
