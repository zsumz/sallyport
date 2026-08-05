import { spawnSync } from 'node:child_process';

export interface CommandResult {
    stdout: string;
    stderr: string;
}

export interface CommandOptions {
    cwd: string;
    env?: Readonly<Record<string, string | undefined>>;
}

// Release-critical subprocesses always use argument arrays; never a shell.
export function runCommand(
    command: string,
    args: readonly string[],
    options: CommandOptions,
): CommandResult {
    const result = spawnSync(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        env: options.env === undefined
            ? process.env
            : { ...options.env },
        shell: false,
    });
    const stdout = commandOutput(result.stdout);
    const stderr = commandOutput(result.stderr);
    if (result.status !== 0) {
        throw new Error([
            `Command failed: ${command} ${args.join(' ')}`,
            result.error?.message,
            stdout.trim(),
            stderr.trim(),
        ].filter(Boolean).join('\n'));
    }
    return { stdout, stderr };
}

export function commandSucceeds(
    command: string,
    args: readonly string[],
    options: CommandOptions,
): boolean {
    return spawnSync(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        env: options.env === undefined
            ? process.env
            : { ...options.env },
        shell: false,
    }).status === 0;
}

function commandOutput(value: unknown): string {
    return typeof value === 'string' ? value : '';
}
