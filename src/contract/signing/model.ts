import type { CommandOptions, CommandResult } from '../../report/exec.ts';

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

export interface TagCommitRequest {
    tag: string;
    expectedCommit: string;
    cwd: string;
    exec: CommandRunner;
}

export interface TagObjectRequest {
    tag: string;
    cwd: string;
    exec: CommandRunner;
}

export type VerificationResult =
    | { ok: true }
    | { ok: false; failures: string[] };
