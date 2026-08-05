import { result, type CheckOptions, type CheckResult } from './model.ts';
import {
    evaluateBranchRules,
    evaluateTagRules,
    normalizedExpectedChecks,
    type RuleEvaluation,
} from './remote-ruleset-policy.ts';
import { readRemoteJson } from './remote-command.ts';
import { objectsValue, stringProperty } from './remote-shape.ts';
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
    const expectedChecks = normalizedExpectedChecks(target.requiredStatusChecks);
    if (!expectedChecks.ok) {
        return result(id, 'unverified', expectedChecks.message);
    }
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
        (ruleset) => evaluateBranchRules(ruleset, target, expectedChecks.value),
    );
    const tag = inspectRulesets(summaries, 'tag', root, options, evaluateTagRules);
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
        ? result(
            id,
            'pass',
            'no-bypass rulesets protect the default branch and existing v* tags; tag creation is unrestricted.',
        )
        : result(id, 'fail', `${failures.join('; ')}.`);
}

function inspectRulesets(
    summaries: ReadonlyArray<Record<string, unknown>>,
    target: string,
    root: string,
    options: CheckOptions,
    evaluate: (value: unknown) => RuleEvaluation,
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
            continue;
        }
        const evaluation = evaluate(read.value);
        if (evaluation.status === 'match') {
            return { match: true, unverified: null };
        }
        if (evaluation.status === 'unverified') {
            unverified = evaluation.message;
        }
    }
    return { match: false, unverified };
}
