import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FamilyCandidateReceipt } from '../../../candidate/receipt.ts';
import { sha256Hex } from '../../../registry/integrity.ts';
import { errorMessage, failure } from '../../support.ts';
import type { CliEffects } from '../effects.ts';
import {
    CHECKSUM_FILENAME,
    RELEASE_NOTES_FILENAME,
    RELEASE_RECORD_FILENAME,
} from './model.ts';
import {
    familyBundleFailures,
    type FamilyBundleBytes,
} from './family-validate.ts';

export interface FamilyBundleInput {
    candidateDir: string;
    releaseFile: string;
    notesFile: string;
    outputDir: string;
    receipt: FamilyCandidateReceipt;
    receiptBytes: Buffer;
    effects: CliEffects;
}

export async function createFamilyReleaseBundle(input: FamilyBundleInput): Promise<void> {
    const tarballs: Map<string, Buffer> = new Map();
    for (const member of input.receipt.packages) {
        const bytes = await copy(
            input.outputDir,
            member.tarball.filename,
            path.join(input.candidateDir, member.tarball.filename),
        );
        tarballs.set(member.tarball.filename, bytes);
    }
    await writeFile(path.join(input.outputDir, 'candidate.json'), input.receiptBytes);
    const release = await copy(
        input.outputDir,
        RELEASE_RECORD_FILENAME,
        input.releaseFile,
    );
    const notes = await copy(
        input.outputDir,
        RELEASE_NOTES_FILENAME,
        input.notesFile,
    );
    const bundled: FamilyBundleBytes = {
        tarballs,
        receipt: input.receiptBytes,
        release,
        notes,
    };
    const failures = familyBundleFailures(bundled, input.receipt);
    if (failures.length > 0) throw failure('Release bundle failed:', failures);

    const members = [
        ...input.receipt.packages.map((member) => member.tarball.filename),
        'candidate.json',
        RELEASE_RECORD_FILENAME,
        RELEASE_NOTES_FILENAME,
    ];
    const bytes: Map<string, Buffer> = new Map([
        ...tarballs,
        ['candidate.json', input.receiptBytes],
        [RELEASE_RECORD_FILENAME, release],
        [RELEASE_NOTES_FILENAME, notes],
    ]);
    const sums = members.map((name) =>
        sha256Hex(bytes.get(name) ?? Buffer.alloc(0)) + '  ' + name).join('\n');
    await writeFile(path.join(input.outputDir, CHECKSUM_FILENAME), sums + '\n');
    input.effects.log(
        'Wrote the family release bundle to ' + input.outputDir + ': '
        + [...members, CHECKSUM_FILENAME].join(', ') + '.',
    );
}

async function copy(outputDir: string, name: string, source: string): Promise<Buffer> {
    let bytes: Buffer;
    try {
        bytes = await readFile(source);
    } catch (error) {
        throw failure('Release bundle failed:', [
            name + ' could not be read from ' + source + ': ' + errorMessage(error),
        ]);
    }
    await writeFile(path.join(outputDir, name), bytes);
    return bytes;
}
