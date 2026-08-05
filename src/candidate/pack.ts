import { renameSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CommandOptions, CommandResult } from '../report/exec.ts';
import { CANDIDATE_TARBALL_FILENAME } from './receipt.ts';

export type ExecCommand = (
    command: string,
    args: readonly string[],
    options: CommandOptions,
) => CommandResult;

export interface PackOnceInput {
    consumerDir: string;
    outputDir: string;
    exec: ExecCommand;
}

export interface PackOnceResult {
    tarballPath: string;
    reportedFilename: string;
}

// The release candidate is packed exactly once and reused from then onward (design section 4).
export function packOnce(input: PackOnceInput): PackOnceResult {
    const outputDir = path.resolve(input.outputDir);
    const result = input.exec('npm', [
        'pack',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        outputDir,
        '--cache',
        path.join(outputDir, '.npm-cache'),
    ], { cwd: path.resolve(input.consumerDir) });

    const reportedFilename = readPackFilename(parsePackOutput(result.stdout));
    const packedPath = path.join(outputDir, reportedFilename);
    const packed = statSync(packedPath, { throwIfNoEntry: false });
    if (!packed?.isFile()) {
        throw new Error(`npm pack did not create ${reportedFilename}.`);
    }

    const tarballPath = path.join(outputDir, CANDIDATE_TARBALL_FILENAME);
    if (packedPath !== tarballPath) {
        if (statSync(tarballPath, { throwIfNoEntry: false }) !== undefined) {
            throw new Error(`Candidate tarball already exists: ${tarballPath}`);
        }
        renameSync(packedPath, tarballPath);
    }
    return { tarballPath, reportedFilename };
}

function parsePackOutput(stdout: string): unknown {
    const text = stdout.trim();
    const direct = parseJson(text);
    if (direct.parsed) {
        return direct.value;
    }
    const start = firstIndexOf(text, ['[', '{']);
    const end = lastIndexOf(text, [']', '}']);
    if (start !== -1 && end > start) {
        const embedded = parseJson(text.slice(start, end + 1));
        if (embedded.parsed) {
            return embedded.value;
        }
    }
    throw new Error('npm pack did not return JSON output.');
}

function parseJson(text: string): { parsed: true; value: unknown } | { parsed: false } {
    if (text === '') {
        return { parsed: false };
    }
    try {
        const value: unknown = JSON.parse(text);
        return { parsed: true, value };
    } catch {
        return { parsed: false };
    }
}

function firstIndexOf(text: string, characters: readonly string[]): number {
    const found = characters
        .map((character) => text.indexOf(character))
        .filter((index) => index !== -1);
    return found.length === 0 ? -1 : Math.min(...found);
}

function lastIndexOf(text: string, characters: readonly string[]): number {
    return Math.max(...characters.map((character) => text.lastIndexOf(character)));
}

// npm 11 reports an array of packed packages; npm 12 reports an object keyed by package name.
function readPackFilename(value: unknown): string {
    const entries = packEntries(value);
    if (entries.length !== 1) {
        throw new Error('npm pack must return exactly one package.');
    }
    const entry: unknown = entries[0];
    if (
        typeof entry !== 'object'
        || entry === null
        || !('filename' in entry)
        || typeof entry.filename !== 'string'
    ) {
        throw new Error('npm pack did not return a package filename.');
    }
    return safeFilename(entry.filename);
}

function packEntries(value: unknown): unknown[] {
    if (Array.isArray(value)) {
        return value as unknown[];
    }
    if (typeof value === 'object' && value !== null) {
        return Object.values(value) as unknown[];
    }
    throw new Error('npm pack did not return a package list.');
}

function safeFilename(filename: string): string {
    if (
        filename === ''
        || filename !== path.basename(filename)
        || filename.includes('\\')
        || filename.startsWith('.')
        || !filename.endsWith('.tgz')
    ) {
        throw new Error(`npm pack returned an unsafe package filename: ${filename}`);
    }
    return filename;
}
