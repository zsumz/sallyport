import path from 'node:path';

import { normalizeRepositoryUrl } from '../../contract/package.ts';
import { environmentCheck } from './remote-environments.ts';
import { immutableReleaseCheck, signerVariableCheck } from './remote-github.ts';
import type { CheckContext, CheckOptions, CheckResult } from './model.ts';
import { result } from './model.ts';
import { npmMfaCheck, npmTrustCheck } from './remote-npm.ts';
import { readRemoteJson } from './remote-command.ts';
import { rulesetCheck } from './remote-rulesets.ts';
import { stringProperty } from './remote-shape.ts';
import type { RemoteTarget } from './remote-target.ts';

const REMOTE_IDS = [
    'remote-environments',
    'remote-npm-trust',
    'remote-npm-mfa',
    'remote-immutable-releases',
    'remote-signer-variable',
    'remote-rulesets',
] as const;

export function runRemoteChecks(
    context: CheckContext,
    options: CheckOptions,
): CheckResult[] {
    const coordinates = remoteCoordinates(context);
    if (!coordinates.ok) {
        return REMOTE_IDS.map((id) => result(id, 'fail', coordinates.message));
    }
    const repository = readRemoteJson(options, 'gh', [
        'api', `repos/${coordinates.repository}`,
    ]);
    const npmTargets: RemoteTarget[] = coordinates.packageNames.map((packageName) => ({
        repository: coordinates.repository,
        packageName,
        dir: path.resolve(options.dir),
        profile: context.profile,
        defaultBranch: '',
        requiredStatusChecks: context.releaseMetadata?.root.requiredStatusChecks,
    }));
    const npmChecks = [
        aggregateNpmChecks('remote-npm-trust', npmTargets, npmTrustCheck, options),
        aggregateNpmChecks('remote-npm-mfa', npmTargets, npmMfaCheck, options),
    ];
    if (!repository.ok) {
        return unavailableGitHubChecks(context, npmChecks, repository.message);
    }
    const defaultBranch = stringProperty(repository.value, 'default_branch');
    if (defaultBranch === null || defaultBranch === '') {
        const message = 'GitHub returned no default branch for the repository.';
        return unavailableGitHubChecks(context, npmChecks, message);
    }
    const npmTarget = npmTargets[0];
    if (npmTarget === undefined) {
        return REMOTE_IDS.map((id) => result(id, 'fail', 'no release packages are configured.'));
    }
    const target: RemoteTarget = { ...npmTarget, defaultBranch };
    return [
        environmentCheck(target, options),
        ...npmChecks,
        immutableReleaseCheck(target, options),
        signerVariableCheck(target, options),
        rulesetCheck(target, options),
    ];
}

function unavailableGitHubChecks(
    context: CheckContext,
    npmChecks: readonly CheckResult[],
    message: string,
): CheckResult[] {
    const signer = context.profile === 'strict'
        ? result('remote-signer-variable', 'unverified', message)
        : result(
            'remote-signer-variable',
            'skip',
            'the standard profile does not require signed tags.',
        );
    return [
        result('remote-environments', 'unverified', message),
        ...npmChecks,
        result('remote-immutable-releases', 'unverified', message),
        signer,
        result('remote-rulesets', 'unverified', message),
    ];
}

function remoteCoordinates(context: CheckContext):
    | { ok: true; repository: string; packageNames: string[] }
    | { ok: false; message: string } {
    const release = context.releaseMetadata;
    const repository = normalizeRepositoryUrl(release?.root.repositoryUrl ?? '');
    const packageNames = release?.packages
        .map((member) => member.name?.trim() ?? '') ?? [];
    if (repository === null || packageNames.length === 0
        || packageNames.some((name) => name === '')) {
        return {
            ok: false,
            message: 'valid package and GitHub repository metadata are required for remote checks.',
        };
    }
    return { ok: true, repository, packageNames };
}

function aggregateNpmChecks(
    id: string,
    targets: readonly RemoteTarget[],
    check: (target: RemoteTarget, options: CheckOptions) => CheckResult,
    options: CheckOptions,
): CheckResult {
    const checks = targets.map((target) => ({ target, check: check(target, options) }));
    const status = checks.some((entry) => entry.check.status === 'fail')
        ? 'fail'
        : checks.some((entry) => entry.check.status === 'unverified') ? 'unverified' : 'pass';
    const message = checks.map((entry) =>
        `${entry.target.packageName}: ${entry.check.message}`).join(' ');
    return result(id, status, message);
}
