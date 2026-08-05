import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    CANDIDATE_RECEIPT_NAME,
    CANDIDATE_TARBALL_NAME,
} from '../../../github/artifacts.ts';
import { sha256Hex } from '../../../registry/integrity.ts';
import { parseArgv, requireValue } from '../../args.ts';
import { ensureDirectory, errorMessage, failure } from '../../support.ts';
import type { CliEffects } from '../effects.ts';
import {
    CHECKSUM_FILENAME,
    CHECKSUM_MEMBERS,
    RELEASE_NOTES_FILENAME,
    RELEASE_RECORD_FILENAME,
    type BundleBytes,
} from './model.ts';
import { bundleFailures } from './validate.ts';

export async function createReleaseBundleCommand(
    argv: readonly string[],
    effects: CliEffects,
): Promise<void> {
    const parsed = parseArgv(argv, {
        strings: ['candidate-dir', 'release', 'notes', 'output'],
    });
    const candidateDir = path.resolve(requireValue(parsed, 'candidate-dir'));
    const releaseFile = path.resolve(requireValue(parsed, 'release'));
    const notesFile = path.resolve(requireValue(parsed, 'notes'));
    const outputDir = path.resolve(requireValue(parsed, 'output'));
    await ensureDirectory(outputDir);

    await copyInto(outputDir, CANDIDATE_TARBALL_NAME, path.join(candidateDir, CANDIDATE_TARBALL_NAME));
    await copyInto(outputDir, CANDIDATE_RECEIPT_NAME, path.join(candidateDir, CANDIDATE_RECEIPT_NAME));
    await copyInto(outputDir, RELEASE_RECORD_FILENAME, releaseFile);
    await copyInto(outputDir, RELEASE_NOTES_FILENAME, notesFile);

    // Hashes always describe the copied bytes, never the source files.
    const bundled: BundleBytes = {
        tarball: await readFile(path.join(outputDir, CANDIDATE_TARBALL_NAME)),
        receipt: await readFile(path.join(outputDir, CANDIDATE_RECEIPT_NAME)),
        release: await readFile(path.join(outputDir, RELEASE_RECORD_FILENAME)),
        notes: await readFile(path.join(outputDir, RELEASE_NOTES_FILENAME)),
    };
    const failures = bundleFailures(bundled);
    if (failures.length > 0) {
        throw failure('Release bundle failed:', failures);
    }

    const digests: Record<string, Buffer> = {
        [CANDIDATE_TARBALL_NAME]: bundled.tarball,
        [CANDIDATE_RECEIPT_NAME]: bundled.receipt,
        [RELEASE_RECORD_FILENAME]: bundled.release,
        [RELEASE_NOTES_FILENAME]: bundled.notes,
    };
    const sums = CHECKSUM_MEMBERS
        .map((name) => `${sha256Hex(digests[name] ?? Buffer.alloc(0))}  ${name}`)
        .join('\n');
    await writeFile(path.join(outputDir, CHECKSUM_FILENAME), `${sums}\n`);
    effects.log(
        `Wrote the release bundle to ${outputDir}:`
        + ` ${[...CHECKSUM_MEMBERS, CHECKSUM_FILENAME].join(', ')}.`,
    );
}

async function copyInto(outputDir: string, name: string, source: string): Promise<void> {
    let bytes: Buffer;
    try {
        bytes = await readFile(source);
    } catch (error) {
        throw failure('Release bundle failed:', [
            `${name} could not be read from ${source}: ${errorMessage(error)}`,
        ]);
    }
    await writeFile(path.join(outputDir, name), bytes);
}
