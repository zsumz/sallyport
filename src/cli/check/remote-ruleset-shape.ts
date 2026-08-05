import { arrayProperty, objectProperty, stringProperty } from './remote-shape.ts';

export type RuleEvaluation =
    | { status: 'match' }
    | { status: 'incomplete' }
    | { status: 'unverified'; message: string };

export type CommonRuleFacts =
    | { ok: true; include: string[]; types: string[] }
    | { ok: false; evaluation: RuleEvaluation };

export function commonRuleFacts(value: unknown): CommonRuleFacts {
    const bypassActors = arrayProperty(value, 'bypass_actors');
    const conditions = objectProperty(value, 'conditions');
    const refName = objectProperty(conditions, 'ref_name');
    const includeValue = arrayProperty(refName, 'include');
    const excludeValue = arrayProperty(refName, 'exclude');
    const rules = arrayProperty(value, 'rules');
    if (bypassActors === null || includeValue === null || excludeValue === null || rules === null) {
        return {
            ok: false,
            evaluation: {
                status: 'unverified',
                message: 'GitHub omitted ruleset bypass or ref-condition details.',
            },
        };
    }
    if (bypassActors.length > 0 || excludeValue.length > 0) {
        return { ok: false, evaluation: { status: 'incomplete' } };
    }
    const include = includeValue.filter((entry): entry is string => typeof entry === 'string');
    const types = rules
        .map((rule) => stringProperty(rule, 'type'))
        .filter((type): type is string => type !== null);
    if (include.length !== includeValue.length || types.length !== rules.length) {
        return {
            ok: false,
            evaluation: { status: 'unverified', message: 'GitHub returned malformed ruleset details.' },
        };
    }
    return { ok: true, include, types };
}
