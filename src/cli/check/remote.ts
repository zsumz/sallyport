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
    const npmTarget: RemoteTarget = {
        repository: coordinates.repository,
        packageName: coordinates.packageName,
        dir: path.resolve(options.dir),
        profile: context.profile,
        defaultBranch: '',
    };
    const npmChecks = [npmTrustCheck(npmTarget, options), npmMfaCheck(npmTarget, options)];
    if (!repository.ok) {
        return unavailableGitHubChecks(context, npmChecks, repository.message);
    }
    const defaultBranch = stringProperty(repository.value, 'default_branch');
    if (defaultBranch === null || defaultBranch === '') {
        const message = 'GitHub returned no default branch for the repository.';
        return unavailableGitHubChecks(context, npmChecks, message);
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
    | { ok: true; repository: string; packageName: string }
    | { ok: false; message: string } {
    const repository = normalizeRepositoryUrl(context.metadata?.repositoryUrl ?? '');
    const packageName = context.metadata?.name?.trim();
    if (repository === null || packageName === undefined || packageName === '') {
        return {
            ok: false,
            message: 'valid package and GitHub repository metadata are required for remote checks.',
        };
    }
    return { ok: true, repository, packageName };
}
