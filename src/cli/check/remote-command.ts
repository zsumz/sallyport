import { errorMessage } from '../support.ts';
import type { CheckOptions } from './model.ts';

export type RemoteRead<T> =
    | { ok: true; value: T }
    | { ok: false; message: string };

export function readRemoteJson(
    options: CheckOptions,
    command: string,
    args: readonly string[],
): RemoteRead<unknown> {
    const read = readRemoteText(options, command, args);
    if (!read.ok) {
        return read;
    }
    if (read.value === '') {
        return { ok: false, message: `${command} returned no auditable output.` };
    }
    try {
        return { ok: true, value: JSON.parse(read.value) as unknown };
    } catch {
        return { ok: false, message: `${command} returned invalid JSON.` };
    }
}

export function readRemoteText(
    options: CheckOptions,
    command: string,
    args: readonly string[],
): RemoteRead<string> {
    try {
        const commandOptions = options.env === undefined
            ? { cwd: options.dir }
            : { cwd: options.dir, env: options.env };
        const output = options.exec(command, args, commandOptions).stdout.trim();
        return { ok: true, value: output };
    } catch (error) {
        const lines = errorMessage(error).split('\n').map((line) => line.trim()).filter(Boolean);
        const detail = npmJsonSummary(lines)
            ?? lines.find((line) =>
                !line.startsWith('Command failed:')
                && line !== '{'
                && line !== '}'
                && !line.endsWith('{'));
        return {
            ok: false,
            message: detail ?? `${command} could not read the remote setting.`,
        };
    }
}

function npmJsonSummary(lines: readonly string[]): string | null {
    const line = lines.find((candidate) => candidate.startsWith('"summary":'));
    if (line === undefined) {
        return null;
    }
    const encoded = line.slice(line.indexOf(':') + 1).replace(/,$/u, '').trim();
    try {
        const value: unknown = JSON.parse(encoded);
        return typeof value === 'string' ? value.split('\n')[0] ?? null : null;
    } catch {
        return null;
    }
}
