import { result, type CheckOptions, type CheckResult } from './model.ts';
import { readRemoteJson } from './remote-command.ts';
import {
    arrayProperty,
    objectProperty,
    objectsValue,
    stringProperty,
} from './remote-shape.ts';
import type { RemoteTarget } from './remote-target.ts';

interface RuleSetState {
    match: boolean;
    unverified: string | null;
}

export function rulesetCheck(
    target: RemoteTarget,
    options: CheckOptions,
): CheckResult {
    const id = 'remote-rulesets';
    const root = `repos/${target.repository}/rulesets`;
    const list = readRemoteJson(options, 'gh', ['api', root]);
    if (!list.ok) {
        return result(id, 'unverified', list.message);
    }
    const summaries = objectsValue(list.value);
    if (summaries === null) {
        return result(id, 'unverified', 'GitHub returned an unexpected ruleset response.');
    }
    const branch = inspectRulesets(
        summaries,
        'branch',
        root,
        options,
        (ruleset) => branchRulesMatch(ruleset, target),
    );
    const tag = inspectRulesets(
        summaries,
        'tag',
        root,
        options,
        tagRulesMatch,
    );
    const readFailure = branch.unverified ?? tag.unverified;
    if (readFailure !== null) {
        return result(id, 'unverified', readFailure);
    }
    const failures: string[] = [];
    if (!branch.match) {
        failures.push('the default branch ruleset is incomplete');
    }
    if (!tag.match) {
        failures.push('the v* tag ruleset is incomplete');
    }
    return failures.length === 0
        ? result(id, 'pass', 'active rulesets protect the default branch and v* tags.')
        : result(id, 'fail', `${failures.join('; ')}.`);
}

function inspectRulesets(
    summaries: ReadonlyArray<Record<string, unknown>>,
    target: string,
    root: string,
    options: CheckOptions,
    matches: (value: unknown) => boolean,
): RuleSetState {
    const candidates = summaries.filter((entry) =>
        stringProperty(entry, 'target') === target
        && stringProperty(entry, 'enforcement') === 'active');
    let unverified: string | null = null;
    for (const candidate of candidates) {
        const rulesetId = candidate.id;
        if (typeof rulesetId !== 'number') {
            unverified = 'GitHub returned a ruleset without a numeric id.';
            continue;
        }
        const read = readRemoteJson(options, 'gh', ['api', `${root}/${String(rulesetId)}`]);
        if (!read.ok) {
            unverified = read.message;
        } else if (matches(read.value)) {
            return { match: true, unverified: null };
        }
    }
    return { match: false, unverified };
}

function branchRulesMatch(value: unknown, target: RemoteTarget): boolean {
    const include = includedRefs(value);
    const types = ruleTypes(value);
    const required = [
        'deletion',
        'non_fast_forward',
        'pull_request',
        'required_linear_history',
        'required_status_checks',
    ];
    if (target.profile === 'strict') {
        required.push('required_signatures');
    }
    const statusRule = arrayProperty(value, 'rules')?.find(
        (rule) => stringProperty(rule, 'type') === 'required_status_checks',
    );
    const statusChecks = arrayProperty(objectProperty(statusRule, 'parameters'), 'required_status_checks');
    return (include.includes('~DEFAULT_BRANCH')
        || include.includes(`refs/heads/${target.defaultBranch}`))
        && required.every((type) => types.includes(type))
        && statusChecks !== null
        && statusChecks.length > 0;
}

function tagRulesMatch(value: unknown): boolean {
    const include = includedRefs(value);
    const types = ruleTypes(value);
    return include.includes('refs/tags/v*')
        && ['deletion', 'non_fast_forward', 'update'].every((type) => types.includes(type));
}

function includedRefs(value: unknown): string[] {
    const conditions = objectProperty(value, 'conditions');
    const refName = objectProperty(conditions, 'ref_name');
    return (arrayProperty(refName, 'include') ?? [])
        .filter((entry): entry is string => typeof entry === 'string');
}

function ruleTypes(value: unknown): string[] {
    return (arrayProperty(value, 'rules') ?? [])
        .map((rule) => stringProperty(rule, 'type'))
        .filter((type): type is string => type !== null);
}
