import type { CommandOptions, CommandResult } from '../../report/exec.ts';
export const UNRECOGNIZED = 'attestation format not recognized';

export type CommandRunner = (
    command: string,
    args: readonly string[],
    options: CommandOptions,
) => CommandResult;

export interface ExpectedProvenance {
    packageName: string;
    packageVersion: string;
    repository: string;
    workflowPath: string;
    tagRef: string;
    tarballSha512: string;
    runId?: number;
}

export interface ProvenanceBundleInput {
    bundle: unknown;
    expected: ExpectedProvenance;
}

export interface AuditProof {
    failures: string[];
    provenanceBundle: object | null;
}

export interface AuditSignaturesInput {
    exec: CommandRunner;
    installDir: string;
    cacheDir?: string;
}

export type AuditOutcome =
    | { ok: true; report: unknown }
    | { ok: false; failures: string[] };

export interface ProvenanceVerificationInput {
    exec: CommandRunner;
    installDir: string;
    expected: ExpectedProvenance;
    cacheDir?: string;
}

export type ProvenanceResult =
    | { ok: true }
    | { ok: false; failures: string[] };
