export type Fields = Record<string, unknown>;

export function asRecord(value: unknown): Fields | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Fields
        : null;
}

export function checkKeys(
    fields: Fields,
    label: string,
    allowed: readonly string[],
    failures: string[],
): void {
    for (const key of Object.keys(fields)) {
        if (!allowed.includes(key)) {
            failures.push(`${label} has an unknown property "${key}".`);
        }
    }
}

export function nested(
    fields: Fields,
    parent: string,
    key: string,
    allowed: readonly string[],
    failures: string[],
): Fields | null {
    const path = fieldPath(parent, key);
    const value = asRecord(fields[key]);
    if (value === null) {
        failures.push(`${path} must be a JSON object.`);
        return null;
    }
    checkKeys(value, path, allowed, failures);
    return value;
}

export function checkPattern(
    fields: Fields,
    parent: string,
    key: string,
    pattern: RegExp,
    description: string,
    failures: string[],
): string | null {
    const value = fields[key];
    if (typeof value !== 'string' || !pattern.test(value)) {
        failures.push(`${fieldPath(parent, key)} must be ${description}.`);
        return null;
    }
    return value;
}

export function checkLiteral(
    fields: Fields,
    parent: string,
    key: string,
    expected: string | number | boolean,
    failures: string[],
): void {
    if (fields[key] !== expected) {
        failures.push(`${fieldPath(parent, key)} must be ${JSON.stringify(expected)}.`);
    }
}

export function checkBoolean(
    fields: Fields,
    parent: string,
    key: string,
    failures: string[],
): boolean | null {
    const value = fields[key];
    if (typeof value !== 'boolean') {
        failures.push(`${fieldPath(parent, key)} must be a boolean.`);
        return null;
    }
    return value;
}

export function checkPositiveInteger(
    fields: Fields,
    parent: string,
    key: string,
    failures: string[],
): void {
    const value = fields[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        failures.push(`${fieldPath(parent, key)} must be a positive integer.`);
    }
}

function fieldPath(parent: string, key: string): string {
    return parent === '' ? key : `${parent}.${key}`;
}
