import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { packOnce, type ExecCommand } from '../../../src/candidate/pack.ts';
import { inspectCandidateTarball } from '../../../src/candidate/inspect.ts';
import { runCommand } from '../../../src/report/exec.ts';

interface RecordedCall {
    command: string;
    args: string[];
    cwd: string;
}

const PACKED_FILENAME = 'sallyport-fixture-1.2.3.tgz';
const PACKED_BYTES = 'packed-tarball-bytes';

let root = '';
let consumerDir = '';
let outputDir = '';
let calls: RecordedCall[] = [];

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sallyport-pack-'));
    consumerDir = path.join(root, 'consumer');
    outputDir = path.join(root, 'output');
    mkdirSync(consumerDir);
    mkdirSync(outputDir);
    calls = [];
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

function exec(stdout: string, produced: string | null = PACKED_FILENAME): ExecCommand {
    return (command, args, options) => {
        calls.push({ command, args: [...args], cwd: options.cwd });
        if (produced !== null) {
            writeFileSync(path.join(outputDir, produced), PACKED_BYTES);
        }
        return { stdout, stderr: '' };
    };
}

function arrayOutput(filename: string = PACKED_FILENAME): string {
    return JSON.stringify([{ id: 'sallyport-fixture@1.2.3', filename }]);
}

function objectOutput(filename: string = PACKED_FILENAME): string {
    return JSON.stringify({ 'sallyport-fixture': { id: 'sallyport-fixture@1.2.3', filename } });
}

describe('packOnce', () => {
    it('packs once and renames the tarball to the fixed safe name', () => {
        const result = packOnce({ consumerDir, outputDir, exec: exec(arrayOutput()) });

        expect(result).toEqual({
            tarballPath: path.join(outputDir, 'package.tgz'),
            reportedFilename: PACKED_FILENAME,
        });
        expect(readFileSync(result.tarballPath, 'utf8')).toBe(PACKED_BYTES);
        expect(existsSync(path.join(outputDir, PACKED_FILENAME))).toBe(false);
    });

    it('runs npm pack with ignored scripts and an isolated cache', () => {
        packOnce({ consumerDir, outputDir, exec: exec(arrayOutput()) });

        expect(calls).toEqual([{
            command: 'npm',
            args: [
                'pack',
                '--ignore-scripts',
                '--json',
                '--pack-destination',
                outputDir,
                '--cache',
                path.join(outputDir, '.npm-cache'),
            ],
            cwd: consumerDir,
        }]);
    });

    it('accepts the object form npm reports for a single package', () => {
        const result = packOnce({ consumerDir, outputDir, exec: exec(objectOutput()) });

        expect(result.reportedFilename).toBe(PACKED_FILENAME);
    });

    it('tolerates notices printed around the JSON payload', () => {
        const stdout = `npm notice packing\n${arrayOutput()}\nnpm notice done\n`;

        expect(packOnce({ consumerDir, outputDir, exec: exec(stdout) }).reportedFilename)
            .toBe(PACKED_FILENAME);
    });

    it('rejects multiple packed packages', () => {
        const stdout = JSON.stringify([{ filename: 'a-1.0.0.tgz' }, { filename: 'b-1.0.0.tgz' }]);

        expect(() => packOnce({ consumerDir, outputDir, exec: exec(stdout) }))
            .toThrow('npm pack must return exactly one package.');
    });

    it('rejects multiple packed packages reported as an object', () => {
        const stdout = JSON.stringify({
            a: { filename: 'a-1.0.0.tgz' },
            b: { filename: 'b-1.0.0.tgz' },
        });

        expect(() => packOnce({ consumerDir, outputDir, exec: exec(stdout) }))
            .toThrow('npm pack must return exactly one package.');
    });

    it('rejects an empty pack result', () => {
        expect(() => packOnce({ consumerDir, outputDir, exec: exec('[]') }))
            .toThrow('npm pack must return exactly one package.');
    });

    it('rejects a pack result that is not a list', () => {
        expect(() => packOnce({ consumerDir, outputDir, exec: exec('"nope"') }))
            .toThrow('npm pack did not return a package list.');
    });

    it('rejects output that is not JSON', () => {
        for (const stdout of ['npm ERR! broke', 'npm notice { broken ] tail']) {
            expect(() => packOnce({ consumerDir, outputDir, exec: exec(stdout) }))
                .toThrow('npm pack did not return JSON output.');
        }
    });

    it('rejects empty output', () => {
        expect(() => packOnce({ consumerDir, outputDir, exec: exec('') }))
            .toThrow('npm pack did not return JSON output.');
    });

    it('rejects a pack entry without a filename', () => {
        expect(() => packOnce({ consumerDir, outputDir, exec: exec('[{"id":"x"}]') }))
            .toThrow('npm pack did not return a package filename.');
    });

    it('rejects unsafe filenames', () => {
        const unsafe = [
            '../escape.tgz',
            'nested/package.tgz',
            '.hidden.tgz',
            'package.txt',
            'package.tgz.bak',
        ];
        for (const filename of unsafe) {
            expect(() => packOnce({
                consumerDir,
                outputDir,
                exec: exec(arrayOutput(filename), null),
            })).toThrow(/unsafe package filename/u);
        }
    });

    it('rejects a filename npm did not actually create', () => {
        expect(() => packOnce({ consumerDir, outputDir, exec: exec(arrayOutput(), null) }))
            .toThrow(`npm pack did not create ${PACKED_FILENAME}.`);
    });

    it('refuses to overwrite an existing candidate tarball', () => {
        writeFileSync(path.join(outputDir, 'package.tgz'), 'earlier');

        expect(() => packOnce({ consumerDir, outputDir, exec: exec(arrayOutput()) }))
            .toThrow(/Candidate tarball already exists/u);
    });

    it('accepts a pack result already named package.tgz', () => {
        const result = packOnce({
            consumerDir,
            outputDir,
            exec: exec(arrayOutput('package.tgz'), 'package.tgz'),
        });

        expect(result.reportedFilename).toBe('package.tgz');
        expect(readFileSync(result.tarballPath, 'utf8')).toBe(PACKED_BYTES);
    });

    it('packs a real package with npm and produces an inspectable candidate', () => {
        writeFileSync(
            path.join(consumerDir, 'package.json'),
            `${JSON.stringify({
                name: 'sallyport-pack-fixture',
                version: '4.5.6',
                private: false,
                main: 'index.js',
            }, null, 2)}\n`,
        );
        writeFileSync(path.join(consumerDir, 'index.js'), 'export const packed = true;\n');

        const result = packOnce({ consumerDir, outputDir, exec: runCommand });
        const inspection = inspectCandidateTarball(readFileSync(result.tarballPath));

        expect(result.tarballPath).toBe(path.join(outputDir, 'package.tgz'));
        expect(result.reportedFilename).toBe('sallyport-pack-fixture-4.5.6.tgz');
        expect(inspection.failures).toEqual([]);
        expect(inspection.name).toBe('sallyport-pack-fixture');
        expect(inspection.version).toBe('4.5.6');
        expect(inspection.files.map((entry) => entry.path).sort()).toEqual([
            'package/index.js',
            'package/package.json',
        ]);
    });
});
