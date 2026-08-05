import { mkdir, readFile, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Failures are reported as one line each so the caller can annotate every one.
export function failure(summary: string, failures: readonly string[]): Error {
    return new Error([summary, ...failures].join('\n'));
}

export async function pathStat(target: string): Promise<Stats | null> {
    try {
        return await stat(target);
    } catch {
        return null;
    }
}

export async function isFile(target: string): Promise<boolean> {
    return (await pathStat(target))?.isFile() ?? false;
}

export async function isDirectory(target: string): Promise<boolean> {
    return (await pathStat(target))?.isDirectory() ?? false;
}

export async function readTextFile(target: string): Promise<string | null> {
    try {
        return await readFile(target, 'utf8');
    } catch {
        return null;
    }
}

export async function readJsonFile(target: string): Promise<unknown> {
    const text = await readTextFile(target);
    if (text === null) {
        return undefined;
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
}

export async function ensureDirectory(target: string): Promise<void> {
    await mkdir(target, { recursive: true });
}

export function readField(value: unknown, key: string): unknown {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) {
        return undefined;
    }
    return (value as Record<string, unknown>)[key];
}

export function readStringField(value: unknown, key: string): string | null {
    const field = readField(value, key);
    return typeof field === 'string' ? field : null;
}

export function readStringMap(value: unknown, key: string): Record<string, string> {
    const field = readField(value, key);
    if (typeof field !== 'object' || field === null) {
        return {};
    }
    const entries = Object.entries(field as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    return Object.fromEntries(entries);
}

export function jsonDocument(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}
