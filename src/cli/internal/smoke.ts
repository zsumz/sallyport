import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    hashTarball,
    verifyTarballUnchanged,
    type TarballDigest,
} from '../../candidate/inspect.ts';
import { parseArgv, requireValue } from '../args.ts';
import { ensureDirectory, errorMessage, failure } from '../support.ts';
import type { CliEffects } from './effects.ts';

export const SMOKE_TARBALL_FILENAME = 'smoke-package.tgz';
export const SMOKE_DIRECTORY = 'sallyport-smoke';
export const PUBLIC_SMOKE_DIRECTORY = 'sallyport-public-smoke';

const SMOKE_TAIL_LINES = 20;

export interface SmokeRequest {
    consumerDir: string;
    tarball: Buffer;
    directory: string;
    packageName: string;
    version: string;
    distTag: string;
    effects: CliEffects;
}

export interface SmokeOutcome {
    copyPath: string;
    before: TarballDigest;
    failures: string[];
}

export function smokeDirectory(effects: CliEffects, name: string): string {
    const base = effects.env.RUNNER_TEMP ?? tmpdir();
    return path.join(base, name);
}

// Package code sees a copy, which is hashed before and after the smoke command.
export async function runReleaseSmoke(request: SmokeRequest): Promise<SmokeOutcome> {
    const { effects } = request;
    const before = hashTarball(request.tarball);
    await ensureDirectory(request.directory);
    const copyPath = path.join(request.directory, SMOKE_TARBALL_FILENAME);
    await writeFile(copyPath, request.tarball);

    const failures: string[] = [];
    try {
        const result = effects.exec('npm', ['run', 'release:smoke'], {
            cwd: request.consumerDir,
            env: {
                ...effects.env,
                SALLYPORT_TARBALL: copyPath,
                SALLYPORT_PACKAGE: request.packageName,
                SALLYPORT_VERSION: request.version,
                SALLYPORT_DIST_TAG: request.distTag,
            },
        });
        const output = tail(result.stdout);
        if (output !== '') {
            effects.log(output);
        }
    } catch (error) {
        failures.push(errorMessage(error));
    }
    failures.push(...await unchangedFailures(copyPath, before));
    return { copyPath, before, failures };
}

export async function smokeCommand(
    argv: readonly string[],
    effects: CliEffects,
): Promise<void> {
    const parsed = parseArgv(argv, {
        strings: ['consumer', 'tarball', 'package', 'version', 'dist-tag'],
    });
    const consumerDir = path.resolve(requireValue(parsed, 'consumer'));
    const tarballPath = path.resolve(requireValue(parsed, 'tarball'));
    const packageName = requireValue(parsed, 'package');
    const version = requireValue(parsed, 'version');
    const distTag = requireValue(parsed, 'dist-tag');

    const authoritative = await readFile(tarballPath);
    const outcome = await runReleaseSmoke({
        consumerDir,
        tarball: authoritative,
        directory: smokeDirectory(effects, SMOKE_DIRECTORY),
        packageName,
        version,
        distTag,
        effects,
    });
    const failures = [
        ...outcome.failures,
        ...await unchangedFailures(tarballPath, outcome.before),
    ];
    if (failures.length > 0) {
        throw failure(`Candidate smoke failed for ${packageName}@${version}:`, failures);
    }
    effects.log(
        `Smoked ${packageName}@${version} (${distTag}) from ${outcome.copyPath};`
        + ' the candidate tarball is unchanged.',
    );
}

async function unchangedFailures(file: string, before: TarballDigest): Promise<string[]> {
    let bytes: Buffer;
    try {
        bytes = await readFile(file);
    } catch {
        return [`the smoke run removed ${file}.`];
    }
    const verified = verifyTarballUnchanged({ before, afterBuffer: bytes });
    return verified.unchanged ? [] : verified.failures.map((line) => `${file}: ${line}`);
}

function tail(output: string): string {
    return output
        .split('\n')
        .filter((line) => line.trim() !== '')
        .slice(-SMOKE_TAIL_LINES)
        .join('\n');
}
