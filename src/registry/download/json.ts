// Shared unknown-narrowing helpers for every injected API payload in this area.
export function readProperty(value: unknown, key: string): unknown {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) {
        return undefined;
    }
    return (value as Record<string, unknown>)[key];
}

export function readStringProperty(value: unknown, key: string): string | null {
    const property = readProperty(value, key);
    return typeof property === 'string' ? property : null;
}

export function readNumberProperty(value: unknown, key: string): number | null {
    const property = readProperty(value, key);
    return typeof property === 'number' && Number.isFinite(property) ? property : null;
}

export function readBooleanProperty(value: unknown, key: string): boolean | null {
    const property = readProperty(value, key);
    return typeof property === 'boolean' ? property : null;
}

export function readArrayProperty(value: unknown, key: string): unknown[] | null {
    const property = readProperty(value, key);
    return Array.isArray(property) ? property : null;
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
}
