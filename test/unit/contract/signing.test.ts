import { describe, expect, it } from 'vitest';
import type { CommandResult } from '../../../src/report/exec.ts';
import {
    type CommandRunner,
    normalizeFingerprint,
    verifySignedTag,
    verifyTagCommit,
    verifyTagReachableFromBranch,
} from '../../../src/contract/signing.ts';

const PRIMARY_KEY = 'B58439871CD2A7275B20CC19EC8E4D26598A0373';
const SIGNING_SUBKEY = '0F1E2D3C4B5A69788796A5B4C3D2E1F001234567';
const OTHER_KEY = 'AAA439871CD2A7275B20CC19EC8E4D26598A0373';
const TAG = 'v0.1.2';
const CWD = '/workspace/consumer';

function rawSignature(primaryKey: string | null): string {
    const validsig = [
        `[GNUPG:] VALIDSIG ${SIGNING_SUBKEY}`,
        '2026-01-01',
        '1767225600',
        '0',
        '4',
        '0',
        '22',
        '8',
        '00',
        primaryKey,
    ].filter((field) => field !== null).join(' ');
    return [
        '[GNUPG:] NEWSIG',
        `[GNUPG:] KEY_CONSIDERED ${PRIMARY_KEY} 0`,
        '[GNUPG:] SIG_ID 6nqzoW9Nvz2Tw 2026-01-01 1767225600',
        '[GNUPG:] GOODSIG EC8E4D26598A0373 zsumz <shawn@zsumz.com>',
        validsig,
        '[GNUPG:] TRUST_ULTIMATE 0 pgp',
    ].join('\n');
}

function fakeExec(
    responses: Readonly<Record<string, string | Error>>,
): { exec: CommandRunner; calls: string[] } {
    const calls: string[] = [];
    const exec: CommandRunner = (command, args, options) => {
        expect(options.cwd).toBe(CWD);
        const key = [command, ...args].join(' ');
        calls.push(key);
        const response = responses[key];
        if (response === undefined) {
            throw new Error(`Command failed: ${key}`);
        }
        if (response instanceof Error) {
            throw response;
        }
        const result: CommandResult = { stdout: '', stderr: response };
        return result;
    };
    return { exec, calls };
}

function signedTagResponses(
    overrides: Readonly<Record<string, string | Error>> = {},
): Record<string, string | Error> {
    return {
        [`git cat-file -t refs/tags/${TAG}`]: 'tag\n',
        [`git verify-tag --raw ${TAG}`]: rawSignature(PRIMARY_KEY),
        ...overrides,
    };
}

function failuresOf(
    responses: Readonly<Record<string, string | Error>>,
    expectedFingerprint = PRIMARY_KEY,
): string[] {
    const { exec } = fakeExec(responses);
    const result = verifySignedTag({
        tag: TAG,
        expectedFingerprint,
        cwd: CWD,
        exec,
    });
    return result.ok ? [] : result.failures;
}

describe('normalizeFingerprint', () => {
    it('accepts 40 hex characters', () => {
        expect(normalizeFingerprint(PRIMARY_KEY)).toBe(PRIMARY_KEY);
    });

    it('strips spaces, colons, and an 0x prefix, then uppercases', () => {
        expect(normalizeFingerprint('b58439871cd2a7275b20cc19ec8e4d26598a0373'))
            .toBe(PRIMARY_KEY);
        expect(normalizeFingerprint('B584 3987 1CD2 A727 5B20  CC19 EC8E 4D26 598A 0373'))
            .toBe(PRIMARY_KEY);
        expect(normalizeFingerprint(
            'B5:84:39:87:1C:D2:A7:27:5B:20:CC:19:EC:8E:4D:26:59:8A:03:73',
        )).toBe(PRIMARY_KEY);
        expect(normalizeFingerprint(`0x${PRIMARY_KEY}`)).toBe(PRIMARY_KEY);
        expect(normalizeFingerprint(`0X${PRIMARY_KEY.toLowerCase()}`))
            .toBe(PRIMARY_KEY);
        expect(normalizeFingerprint(`\t${PRIMARY_KEY}\n`)).toBe(PRIMARY_KEY);
    });

    it('rejects anything that is not exactly 40 hex characters', () => {
        expect(normalizeFingerprint('')).toBeNull();
        expect(normalizeFingerprint('EC8E4D26598A0373')).toBeNull();
        expect(normalizeFingerprint(`${PRIMARY_KEY}0`)).toBeNull();
        expect(normalizeFingerprint(PRIMARY_KEY.replace('B', 'Z'))).toBeNull();
        expect(normalizeFingerprint('0x0x'.padEnd(44, '0'))).toBeNull();
    });
});

describe('verifySignedTag', () => {
    it('accepts an annotated tag with a good signature from the expected key', () => {
        const { exec, calls } = fakeExec(signedTagResponses());
        expect(verifySignedTag({
            tag: TAG,
            expectedFingerprint: PRIMARY_KEY,
            cwd: CWD,
            exec,
        })).toEqual({ ok: true });
        expect(calls).toEqual([
            `git cat-file -t refs/tags/${TAG}`,
            `git verify-tag --raw ${TAG}`,
        ]);
    });

    it('accepts a loosely formatted expected fingerprint', () => {
        expect(failuresOf(
            signedTagResponses(),
            `0x${PRIMARY_KEY.toLowerCase()}`,
        )).toEqual([]);
    });

    it('rejects a lightweight tag', () => {
        expect(failuresOf(signedTagResponses({
            [`git cat-file -t refs/tags/${TAG}`]: 'commit\n',
        }))).toEqual([`${TAG} must be an annotated tag.`]);
    });

    it('rejects a missing tag', () => {
        expect(failuresOf(signedTagResponses({
            [`git cat-file -t refs/tags/${TAG}`]: new Error('Command failed'),
        }))).toContain(`${TAG} must be an annotated tag.`);
    });

    it('rejects a bad signature', () => {
        expect(failuresOf(signedTagResponses({
            [`git verify-tag --raw ${TAG}`]: new Error('Command failed'),
        }))).toEqual([`${TAG} must carry a good OpenPGP signature.`]);
    });

    it('rejects output without a GOODSIG line', () => {
        expect(failuresOf(signedTagResponses({
            [`git verify-tag --raw ${TAG}`]: [
                '[GNUPG:] NEWSIG',
                `[GNUPG:] EXPKEYSIG ${SIGNING_SUBKEY} zsumz`,
            ].join('\n'),
        }))).toEqual([
            `${TAG} must carry a good OpenPGP signature.`,
            `${TAG} must be signed by a currently valid key.`,
        ]);
    });

    it('rejects a signature from a different key', () => {
        expect(failuresOf(signedTagResponses({
            [`git verify-tag --raw ${TAG}`]: rawSignature(OTHER_KEY),
        }))).toEqual([
            `${TAG} must be signed by ${PRIMARY_KEY}, found ${OTHER_KEY}.`,
        ]);
    });

    it('compares the primary key, not the signing subkey', () => {
        expect(failuresOf(signedTagResponses(), SIGNING_SUBKEY)).toEqual([
            `${TAG} must be signed by ${SIGNING_SUBKEY}, found ${PRIMARY_KEY}.`,
        ]);
    });

    it('rejects a VALIDSIG line without a usable fingerprint', () => {
        expect(failuresOf(signedTagResponses({
            [`git verify-tag --raw ${TAG}`]: rawSignature(null),
        }))).toEqual([`${TAG} must report a primary key fingerprint.`]);
    });

    it('rejects an unusable expected fingerprint', () => {
        expect(failuresOf(signedTagResponses(), 'not-a-fingerprint')).toEqual([
            'the expected signer fingerprint must be 40 hexadecimal characters.',
        ]);
    });

    it('reports every failure at once', () => {
        expect(failuresOf(
            signedTagResponses({
                [`git cat-file -t refs/tags/${TAG}`]: 'commit\n',
                [`git verify-tag --raw ${TAG}`]: rawSignature(OTHER_KEY),
            }),
            'nope',
        )).toEqual([
            'the expected signer fingerprint must be 40 hexadecimal characters.',
            `${TAG} must be an annotated tag.`,
        ]);
    });
});

describe('verifyTagReachableFromBranch', () => {
    const commit = 'a'.repeat(40);
    const branch = 'refs/sallyport/default-branch';

    it('accepts a tag whose commit is an ancestor of the branch', () => {
        const { exec, calls } = fakeExec({
            [`git rev-list -n 1 ${TAG}`]: `${commit}\n`,
            [`git merge-base --is-ancestor ${commit} ${branch}`]: '',
        });
        expect(verifyTagReachableFromBranch({
            tag: TAG,
            branch,
            cwd: CWD,
            exec,
        })).toEqual({ ok: true });
        expect(calls).toEqual([
            `git rev-list -n 1 ${TAG}`,
            `git merge-base --is-ancestor ${commit} ${branch}`,
        ]);
    });

    it('rejects a tag that is not reachable from the branch', () => {
        const { exec } = fakeExec({
            [`git rev-list -n 1 ${TAG}`]: `${commit}\n`,
        });
        expect(verifyTagReachableFromBranch({
            tag: TAG,
            branch,
            cwd: CWD,
            exec,
        })).toEqual({
            ok: false,
            failures: [`${TAG} must point to a commit reachable from ${branch}.`],
        });
    });

    it('rejects a tag that does not resolve to a commit', () => {
        const { exec } = fakeExec({});
        expect(verifyTagReachableFromBranch({
            tag: TAG,
            branch,
            cwd: CWD,
            exec,
        })).toEqual({
            ok: false,
            failures: [`${TAG} must resolve to a commit.`],
        });
    });
});

describe('verifyTagCommit', () => {
    const commit = 'a'.repeat(40);

    it('accepts only the exact peeled tag commit', () => {
        const { exec } = fakeExec({
            [`git rev-parse refs/tags/${TAG}^{commit}`]: `${commit}\n`,
        });
        expect(verifyTagCommit({ tag: TAG, expectedCommit: commit, cwd: CWD, exec }))
            .toEqual({ ok: true });
    });

    it('rejects a moved tag', () => {
        const moved = 'b'.repeat(40);
        const { exec } = fakeExec({
            [`git rev-parse refs/tags/${TAG}^{commit}`]: `${moved}\n`,
        });
        expect(verifyTagCommit({ tag: TAG, expectedCommit: commit, cwd: CWD, exec }))
            .toEqual({
                ok: false,
                failures: [`${TAG} resolves to ${moved}, expected ${commit}.`],
            });
    });

    it('rejects an unresolvable tag', () => {
        const { exec } = fakeExec({});
        expect(verifyTagCommit({ tag: TAG, expectedCommit: commit, cwd: CWD, exec }))
            .toEqual({ ok: false, failures: [`${TAG} must resolve to a commit.`] });
    });
});
