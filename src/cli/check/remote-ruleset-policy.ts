import {
    arrayProperty,
    booleanProperty,
    numberProperty,
    objectProperty,
    stringProperty,
} from './remote-shape.ts';
import {
    commonRuleFacts,
    type RuleEvaluation,
} from './remote-ruleset-shape.ts';
import type { RemoteTarget } from './remote-target.ts';

const GITHUB_ACTIONS_APP_ID = 15_368;

export type { RuleEvaluation } from './remote-ruleset-shape.ts';

export function normalizedExpectedChecks(value: readonly string[] | null | undefined):
    | { ok: true; value: readonly string[] }
    | { ok: false; message: string } {
    if (value === undefined) {
        return {
            ok: false,
            message: 'package.json does not declare sallyport.requiredStatusChecks.',
        };
    }
    if (value === null) {
        return {
            ok: false,
            message: 'package.json sallyport.requiredStatusChecks is not a string array.',
        };
    }
    const normalized = value.map((entry) => entry.trim());
    if (normalized.length === 0 || normalized.some((entry) => entry === '')) {
        return {
            ok: false,
            message: 'package.json sallyport.requiredStatusChecks must list exact CI check names.',
        };
    }
    if (new Set(normalized).size !== normalized.length) {
        return {
            ok: false,
            message: 'package.json sallyport.requiredStatusChecks contains duplicate names.',
        };
    }
    return { ok: true, value: normalized };
}

export function evaluateBranchRules(
    value: unknown,
    target: RemoteTarget,
    expectedChecks: readonly string[],
): RuleEvaluation {
    const common = commonRuleFacts(value);
    if (!common.ok) {
        return common.evaluation;
    }
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
    const coversBranch = common.include.includes('~DEFAULT_BRANCH')
        || common.include.includes(`refs/heads/${target.defaultBranch}`);
    if (!coversBranch || !required.every((type) => common.types.includes(type))) {
        return { status: 'incomplete' };
    }
    const statusRule = arrayProperty(value, 'rules')?.find(
        (rule) => stringProperty(rule, 'type') === 'required_status_checks',
    );
    const parameters = objectProperty(statusRule, 'parameters');
    const statusChecks = arrayProperty(parameters, 'required_status_checks');
    const strict = booleanProperty(parameters, 'strict_required_status_checks_policy');
    if (parameters === null || statusChecks === null || strict === null) {
        return {
            status: 'unverified',
            message: 'GitHub omitted required status-check policy details.',
        };
    }
    return strict && statusChecksMatch(statusChecks, expectedChecks)
        ? { status: 'match' }
        : { status: 'incomplete' };
}

export function evaluateTagRules(value: unknown): RuleEvaluation {
    const common = commonRuleFacts(value);
    if (!common.ok) {
        return common.evaluation;
    }
    const protectsExistingTags = common.include.includes('refs/tags/v*')
        && ['deletion', 'non_fast_forward', 'update']
            .every((type) => common.types.includes(type));
    // Strict mode authorizes creation through the signing fingerprint instead.
    return protectsExistingTags && !common.types.includes('creation')
        ? { status: 'match' }
        : { status: 'incomplete' };
}

function statusChecksMatch(values: readonly unknown[], expected: readonly string[]): boolean {
    const contexts: string[] = [];
    for (const value of values) {
        const context = stringProperty(value, 'context');
        if (context === null || numberProperty(value, 'integration_id') !== GITHUB_ACTIONS_APP_ID) {
            return false;
        }
        contexts.push(context);
    }
    if (new Set(contexts).size !== contexts.length) {
        return false;
    }
    const left = [...contexts].sort();
    const right = [...expected].sort();
    return left.length === right.length
        && left.every((value, index) => value === right[index]);
}
