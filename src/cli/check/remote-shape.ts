export type JsonObject = Record<string, unknown>;

export function objectValue(value: unknown): JsonObject | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as JsonObject
        : null;
}

export function objectsValue(value: unknown): JsonObject[] | null {
    if (!Array.isArray(value)) {
        return null;
    }
    const objects = value.map(objectValue);
    return objects.every((entry) => entry !== null)
        ? objects
        : null;
}

export function arrayProperty(value: unknown, key: string): unknown[] | null {
    const property = objectValue(value)?.[key];
    return Array.isArray(property) ? property : null;
}

export function objectProperty(value: unknown, key: string): JsonObject | null {
    return objectValue(objectValue(value)?.[key]);
}

export function stringProperty(value: unknown, key: string): string | null {
    const property = objectValue(value)?.[key];
    return typeof property === 'string' ? property : null;
}

export function booleanProperty(value: unknown, key: string): boolean | null {
    const property = objectValue(value)?.[key];
    return typeof property === 'boolean' ? property : null;
}

export function numberProperty(value: unknown, key: string): number | null {
    const property = objectValue(value)?.[key];
    return typeof property === 'number' ? property : null;
}
