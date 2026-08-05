import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Node = Record<string, unknown>;

// A deliberately tiny JSON Schema subset checker: the protocol must stay dependency free,
// so the schemas are exercised in test without pulling in a validator package.
export function loadSchema(filename: string): unknown {
    const url = new URL(`../../schemas/${filename}`, import.meta.url);
    const text: unknown = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
    return text;
}

export function schemaFailures(schema: unknown, value: unknown, label: string): string[] {
    const failures: string[] = [];
    checkNode(asNode(schema), value, label, failures);
    return failures;
}

// Every property the example carries must be declared, required and closed by the schema.
export function schemaShapeFailures(schema: unknown, example: unknown, label: string): string[] {
    const failures: string[] = [];
    checkShape(asNode(schema), example, label, failures);
    return failures;
}

export function leafPaths(value: unknown, prefix = ''): string[] {
    const record = asNode(value);
    if (record === null) {
        return [prefix];
    }
    return Object.keys(record).flatMap((key) => leafPaths(record[key], joinPath(prefix, key)));
}

export function objectPaths(value: unknown, prefix = ''): string[] {
    const record = asNode(value);
    if (record === null) {
        return [];
    }
    return [
        prefix,
        ...Object.keys(record).flatMap((key) => objectPaths(record[key], joinPath(prefix, key))),
    ];
}

export function removeAt<T>(value: T, path: string): T {
    const clone = structuredClone(value);
    const { parent, key } = resolve(clone, path);
    Reflect.deleteProperty(parent, key);
    return clone;
}

export function setAt<T>(value: T, path: string, replacement: unknown): T {
    const clone = structuredClone(value);
    const { parent, key } = resolve(clone, path);
    parent[key] = replacement;
    return clone;
}

function resolve(value: unknown, path: string): { parent: Node; key: string } {
    const segments = path.split('.');
    const key = segments[segments.length - 1] ?? '';
    let cursor = asNode(value);
    for (const segment of segments.slice(0, -1)) {
        cursor = asNode(cursor?.[segment]);
    }
    if (cursor === null) {
        throw new Error(`Cannot resolve ${path} in the example.`);
    }
    return { parent: cursor, key };
}

function checkNode(schema: Node | null, value: unknown, path: string, failures: string[]): void {
    if (schema === null) {
        failures.push(`${path} has no schema.`);
        return;
    }
    if (!matchesType(schema.type, value)) {
        failures.push(`${path} has the wrong type.`);
        return;
    }
    if ('const' in schema && value !== schema.const) {
        failures.push(`${path} must equal ${JSON.stringify(schema.const)}.`);
    }
    const pattern = schema.pattern;
    if (typeof pattern === 'string' && typeof value === 'string' && !new RegExp(pattern).test(value)) {
        failures.push(`${path} does not match ${pattern}.`);
    }
    const minimum = schema.minimum;
    if (typeof minimum === 'number' && typeof value === 'number' && value < minimum) {
        failures.push(`${path} must be at least ${String(minimum)}.`);
    }
    const properties = asNode(schema.properties);
    const record = asNode(value);
    if (properties === null || record === null) {
        return;
    }
    for (const key of stringList(schema.required)) {
        if (!(key in record)) {
            failures.push(`${joinPath(path, key)} is required.`);
        }
    }
    if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
            if (!(key in properties)) {
                failures.push(`${joinPath(path, key)} is not allowed.`);
            }
        }
    }
    for (const key of Object.keys(properties)) {
        if (key in record) {
            checkNode(asNode(properties[key]), record[key], joinPath(path, key), failures);
        }
    }
}

function checkShape(schema: Node | null, example: unknown, path: string, failures: string[]): void {
    const record = asNode(example);
    if (record === null) {
        return;
    }
    if (schema === null) {
        failures.push(`${path} has no schema.`);
        return;
    }
    if (schema.additionalProperties !== false) {
        failures.push(`${path} must forbid additional properties.`);
    }
    const properties = asNode(schema.properties) ?? {};
    const keys = Object.keys(record);
    if (!sameMembers(Object.keys(properties), keys)) {
        failures.push(`${path} schema properties do not match the example.`);
    }
    if (!sameMembers(stringList(schema.required), keys)) {
        failures.push(`${path} schema required list does not match the example.`);
    }
    for (const key of keys) {
        checkShape(asNode(properties[key]), record[key], joinPath(path, key), failures);
    }
}

function matchesType(type: unknown, value: unknown): boolean {
    if (type === undefined) {
        return true;
    }
    if (typeof type === 'string') {
        return matchesSingleType(type, value);
    }
    return stringList(type).some((candidate) => matchesSingleType(candidate, value));
}

function matchesSingleType(type: string, value: unknown): boolean {
    if (type === 'object') {
        return asNode(value) !== null;
    }
    if (type === 'array') {
        return Array.isArray(value);
    }
    if (type === 'string') {
        return typeof value === 'string';
    }
    if (type === 'integer') {
        return typeof value === 'number' && Number.isInteger(value);
    }
    if (type === 'number') {
        return typeof value === 'number';
    }
    if (type === 'boolean') {
        return typeof value === 'boolean';
    }
    return type === 'null' && value === null;
}

function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && [...left].sort().join() === [...right].sort().join();
}

function joinPath(parent: string, key: string): string {
    return parent === '' ? key : `${parent}.${key}`;
}

function asNode(value: unknown): Node | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Node
        : null;
}
