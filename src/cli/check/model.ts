import type { PackageMetadata } from '../../contract/package.ts';
import type { CommandRunner } from '../../contract/signing.ts';
import type { Profile } from '../template.ts';

export type CheckStatus = 'pass' | 'fail' | 'skip' | 'unverified';

export interface CheckResult {
    id: string;
    status: CheckStatus;
    message: string;
}

export interface CheckReport {
    checks: CheckResult[];
    ok: boolean;
}

export interface CheckOptions {
    dir: string;
    exec: CommandRunner;
    env?: Readonly<Record<string, string | undefined>>;
    remote?: boolean;
}

export interface WorkflowFile {
    name: string;
    content: string;
}

export interface CheckContext {
    metadata: PackageMetadata | null;
    metadataError: string;
    scripts: Record<string, string>;
    remote: string | null;
    remoteError: string;
    workflow: string | null;
    profile: Profile;
    workflows: WorkflowFile[];
    hasReleaseNotesDirectory: boolean;
    hasSigningKey: boolean;
}

export const SIGNING_KEY_FILE = 'etc/release-signing-key.asc';

export const CHECK_LABELS: ReadonlyArray<readonly [string, string]> = [
    ['package-public', 'package is public'],
    ['lockfile-matches', 'package-lock matches package.json'],
    ['repository-remote', 'repository URL matches Git remote'],
    ['release-check-script', 'release:check exists'],
    ['release-smoke-script', 'release:smoke exists'],
    ['release-notes-directory', 'release notes directory exists'],
    ['signing-key', 'public signing key exists'],
    ['caller-workflow', 'caller workflow is generated correctly'],
    ['workflow-sha-match', 'stage and finalize use the same SHA'],
    ['workflow-sha-length', 'reusable workflows use full 40-character SHAs'],
    ['no-npm-token', 'no npm publishing token appears in workflows'],
    ['no-direct-publish', 'no direct npm publish workflow exists'],
    ['remote-environments', 'GitHub release environments are restricted and secretless'],
    ['remote-npm-trust', 'npm trusted publisher is stage-only'],
    ['remote-npm-mfa', 'npm publishing requires MFA and disallows tokens'],
    ['remote-immutable-releases', 'GitHub Releases are immutable'],
    ['remote-signer-variable', 'repository signer variable matches the public key'],
    ['remote-rulesets', 'default branch and v* tags are protected'],
];

export function result(id: string, status: CheckStatus, message: string): CheckResult {
    return { id, status, message };
}
