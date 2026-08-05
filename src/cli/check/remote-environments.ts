import type { CheckOptions, CheckResult } from './model.ts';
import { result } from './model.ts';
import { readRemoteJson } from './remote-command.ts';
import {
    arrayProperty,
    booleanProperty,
    numberProperty,
    objectProperty,
    stringProperty,
} from './remote-shape.ts';
import type { RemoteTarget } from './remote-target.ts';

interface EnvironmentRequirement {
    name: string;
    refName: string;
    refType: string;
}

const REQUIREMENTS: readonly EnvironmentRequirement[] = [
    { name: 'npm-stage', refName: 'v*', refType: 'tag' },
    { name: 'github-release', refName: 'main', refType: 'branch' },
];

export function environmentCheck(
    target: RemoteTarget,
    options: CheckOptions,
): CheckResult {
    const id = 'remote-environments';
    const root = `repos/${target.repository}/environments`;
    const list = readRemoteJson(options, 'gh', ['api', root]);
    if (!list.ok) {
        return result(id, 'unverified', list.message);
    }
    const environments = arrayProperty(list.value, 'environments');
    if (environments === null) {
        return result(id, 'unverified', 'GitHub returned an unexpected environments response.');
    }
    const failures: string[] = [];
    for (const requirement of requirementsFor(target.defaultBranch)) {
        const environment = environments.find(
            (entry) => stringProperty(entry, 'name') === requirement.name,
        );
        if (environment === undefined) {
            failures.push(`${requirement.name} is missing`);
            continue;
        }
        const policy = objectProperty(environment, 'deployment_branch_policy');
        if (booleanProperty(policy, 'custom_branch_policies') !== true) {
            failures.push(`${requirement.name} does not restrict deployment refs`);
        }
        const remote = inspectEnvironment(root, requirement, options);
        if (!remote.ok) {
            return result(id, 'unverified', remote.message);
        }
        failures.push(...remote.failures);
    }
    return failures.length === 0
        ? result(id, 'pass', 'both environments have exact ref policies and no secrets.')
        : result(id, 'fail', `${failures.join('; ')}.`);
}

function requirementsFor(defaultBranch: string): EnvironmentRequirement[] {
    return REQUIREMENTS.map((entry) => entry.name === 'github-release'
        ? { ...entry, refName: defaultBranch }
        : { ...entry });
}

function inspectEnvironment(
    root: string,
    requirement: EnvironmentRequirement,
    options: CheckOptions,
): { ok: true; failures: string[] } | { ok: false; message: string } {
    const base = `${root}/${requirement.name}`;
    const policies = readRemoteJson(options, 'gh', [
        'api', `${base}/deployment-branch-policies`,
    ]);
    const secrets = readRemoteJson(options, 'gh', ['api', `${base}/secrets`]);
    if (!policies.ok) {
        return policies;
    }
    if (!secrets.ok) {
        return secrets;
    }
    const entries = arrayProperty(policies.value, 'branch_policies');
    const secretCount = numberProperty(secrets.value, 'total_count');
    if (entries === null || secretCount === null) {
        return { ok: false, message: 'GitHub returned an unexpected environment detail response.' };
    }
    const exact = entries.length === 1
        && entries.some((entry) =>
            stringProperty(entry, 'name') === requirement.refName
            && stringProperty(entry, 'type') === requirement.refType);
    const failures: string[] = [];
    if (!exact) {
        failures.push(
            `${requirement.name} must allow only ${requirement.refType} ${requirement.refName}`,
        );
    }
    if (secretCount !== 0) {
        failures.push(`${requirement.name} must contain no secrets`);
    }
    return { ok: true, failures };
}
