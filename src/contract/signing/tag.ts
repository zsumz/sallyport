import { normalizeFingerprint, signatureFailures } from './fingerprint.ts';
import type {
    CommandRunner,
    SignedTagRequest,
    TagCommitRequest,
    TagObjectRequest,
    TagReachabilityRequest,
    VerificationResult,
} from './model.ts';

export function resolveTagObject(request: TagObjectRequest): string | null {
    const object = gitOutput(request.exec, request.cwd, [
        'rev-parse', `refs/tags/${request.tag}`,
    ])?.trim();
    return object !== undefined && /^[0-9a-f]{40}$/u.test(object) ? object : null;
}

export function verifySignedTag(request: SignedTagRequest): VerificationResult {
    const { tag } = request;
    const failures: string[] = [];
    const expected = normalizeFingerprint(request.expectedFingerprint);
    if (expected === null) {
        failures.push('the expected signer fingerprint must be 40 hexadecimal characters.');
    }
    const tagType = gitOutput(request.exec, request.cwd, [
        'cat-file', '-t', `refs/tags/${tag}`,
    ])?.trim();
    if (tagType !== 'tag') {
        failures.push(`${tag} must be an annotated tag.`);
    }
    const signature = gitOutput(request.exec, request.cwd, [
        'verify-tag', '--raw', tag,
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
    const commit = gitOutput(request.exec, request.cwd, ['rev-list', '-n', '1', tag]);
    if (commit === null || commit.trim() === '') {
        return { ok: false, failures: [`${tag} must resolve to a commit.`] };
    }
    const reachable = gitOutput(request.exec, request.cwd, [
        'merge-base', '--is-ancestor', commit.trim(), branch,
    ]);
    return reachable === null
        ? {
            ok: false,
            failures: [`${tag} must point to a commit reachable from ${branch}.`],
        }
        : { ok: true };
}

export function verifyTagCommit(request: TagCommitRequest): VerificationResult {
    const actual = gitOutput(request.exec, request.cwd, [
        'rev-parse', `refs/tags/${request.tag}^{commit}`,
    ])?.trim();
    if (actual === undefined || actual === '') {
        return { ok: false, failures: [`${request.tag} must resolve to a commit.`] };
    }
    if (actual !== request.expectedCommit) {
        return {
            ok: false,
            failures: [
                `${request.tag} resolves to ${actual}, expected ${request.expectedCommit}.`,
            ],
        };
    }
    return { ok: true };
}

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
