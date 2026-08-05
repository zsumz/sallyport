import { result, type CheckOptions, type CheckResult } from './model.ts';
import { readRemoteJson } from './remote-command.ts';
import {
    arrayProperty,
    booleanProperty,
    objectProperty,
    objectValue,
    objectsValue,
    stringProperty,
} from './remote-shape.ts';
import type { RemoteTarget } from './remote-target.ts';

export function npmTrustCheck(
    target: RemoteTarget,
    options: CheckOptions,
): CheckResult {
    const id = 'remote-npm-trust';
    const read = readRemoteJson(options, 'npm', [
        'trust', 'list', target.packageName, '--json',
    ]);
    if (!read.ok) {
        return result(id, 'unverified', read.message);
    }
    const configs = trustConfigs(read.value);
    if (configs === null) {
        return result(id, 'unverified', 'npm returned an unexpected trust response.');
    }
    const expected = configs.some((config) => trustMatches(config, target));
    return expected && configs.length === 1
        ? result(id, 'pass', 'npm trusts only sallyport.yml in npm-stage for staging.')
        : result(id, 'fail', 'npm trust must contain one stage-only sallyport.yml publisher.');
}

export function npmMfaCheck(
    target: RemoteTarget,
    options: CheckOptions,
): CheckResult {
    const id = 'remote-npm-mfa';
    const read = readRemoteJson(options, 'npm', [
        'access', 'get', 'mfa', target.packageName, '--json',
    ]);
    if (!read.ok) {
        return result(
            id,
            'unverified',
            `${read.message} npm may require manual confirmation in package settings.`,
        );
    }
    const policy = mfaPolicy(read.value, target.packageName);
    if (policy === null) {
        return result(id, 'unverified', 'npm returned no readable package MFA policy.');
    }
    return policy
        ? result(id, 'pass', 'package publishing requires MFA and disallows tokens.')
        : result(id, 'fail', 'package publishing must require MFA and disallow tokens.');
}

function trustConfigs(value: unknown): Array<Record<string, unknown>> | null {
    const many = objectsValue(value);
    if (many !== null) {
        return many;
    }
    const one = objectValue(value);
    return one === null ? null : [one];
}

function trustMatches(config: Record<string, unknown>, target: RemoteTarget): boolean {
    const claims = objectProperty(config, 'claims');
    const workflow = objectProperty(claims, 'workflow_ref');
    const permissions = (arrayProperty(config, 'permissions') ?? [])
        .filter((entry): entry is string => typeof entry === 'string');
    const repository = stringProperty(config, 'repository')
        ?? stringProperty(claims, 'repository');
    const file = stringProperty(config, 'file') ?? stringProperty(workflow, 'file');
    const environment = stringProperty(config, 'environment')
        ?? stringProperty(claims, 'environment');
    return stringProperty(config, 'type') === 'github'
        && repository?.toLowerCase() === target.repository.toLowerCase()
        && file === 'sallyport.yml'
        && environment === 'npm-stage'
        && permissions.length === 1
        && permissions[0] === 'createStagedPackage';
}

function mfaPolicy(value: unknown, packageName: string): boolean | null {
    if (value === 'publish') {
        return true;
    }
    const object = objectValue(value);
    if (object === null) {
        return null;
    }
    if (object[packageName] === 'publish') {
        return true;
    }
    const required = booleanProperty(object, 'publish_requires_tfa');
    const overrides = booleanProperty(object, 'automation_token_overrides_tfa');
    return required === null || overrides === null ? null : required && !overrides;
}
