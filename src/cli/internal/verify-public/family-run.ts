import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
    FamilyCandidateReceipt,
    FamilyReleasePackage,
} from '../../../candidate/receipt.ts';
import { DEFAULT_REGISTRY } from '../../../registry/download.ts';
import { sha256Hex } from '../../../registry/integrity.ts';
import { failure, jsonDocument } from '../../support.ts';
import { runFamilyReleaseSmoke } from '../family-smoke.ts';
import type { CliEffects } from '../effects.ts';
import { tarballFailures } from '../fetch-candidate.ts';
import {
    PUBLIC_SMOKE_DIRECTORY,
    smokeDirectory,
} from '../smoke.ts';
import {
    familyPublicSummary,
    createFamilyReleaseRecord,
} from './family-record.ts';
import { verifyFamilyMember } from './family-member.ts';
import { RELEASE_RECORD_FILENAME } from './model.ts';

export interface FamilyPublicInput {
    consumerDir: string;
    candidateDir: string;
    notesFile: string;
    outputDir: string;
    receipt: FamilyCandidateReceipt;
    receiptBytes: Buffer;
    skipSmoke: boolean;
    effects: CliEffects;
}

export async function verifyFamilyPublic(input: FamilyPublicInput): Promise<void> {
    const candidates: Map<string, Uint8Array> = new Map();
    for (const member of input.receipt.packages) {
        candidates.set(
            member.tarball.filename,
            await readFile(path.join(input.candidateDir, member.tarball.filename)),
        );
    }
    const failures = tarballFailures(candidates, input.receipt);
    if (failures.length > 0) throw failure('Public verification failed:', failures);

    const records: FamilyReleasePackage[] = [];
    const publicPackages = [];
    const attempts: number[] = [];
    const registry = input.effects.env.NPM_CONFIG_REGISTRY ?? DEFAULT_REGISTRY;
    for (const [index, member] of input.receipt.packages.entries()) {
        const outcome = await verifyFamilyMember({
            receipt: input.receipt,
            member,
            outputDir: path.join(input.outputDir, 'provenance-' + String(index + 1)),
            registry,
            effects: input.effects,
        });
        attempts.push(outcome.attempts);
        if (outcome.record === null || outcome.publicTarball === null) {
            failures.push(...outcome.failures.map((line) => member.name + ': ' + line));
            continue;
        }
        records.push(outcome.record);
        publicPackages.push({ member, bytes: outcome.publicTarball });
        await writeFile(
            path.join(input.outputDir, member.tarball.filename),
            outcome.publicTarball,
        );
    }
    if (!input.skipSmoke && failures.length === 0) {
        failures.push(...await runFamilyReleaseSmoke({
            consumerDir: input.consumerDir,
            directory: smokeDirectory(input.effects, PUBLIC_SMOKE_DIRECTORY),
            family: input.receipt.family,
            packages: publicPackages,
            effects: input.effects,
        }));
    }
    if (failures.length > 0) throw failure('Public verification failed:', failures);

    const notes = await readFile(input.notesFile);
    if (notes.byteLength === 0) {
        throw failure('Public verification failed:', ['release notes must not be empty.']);
    }
    const record = createFamilyReleaseRecord({
        receipt: input.receipt,
        candidateReceiptSha256: sha256Hex(input.receiptBytes),
        releaseNotesSha256: sha256Hex(notes),
        packages: records,
    });
    const releasePath = path.join(input.outputDir, RELEASE_RECORD_FILENAME);
    await writeFile(releasePath, jsonDocument(record));
    await input.effects.writeOutput({
        release: releasePath,
        package_count: String(record.packages.length),
        public_sha256: record.packages[0]?.registry.sha256 ?? '',
    });
    await input.effects.writeSummary(familyPublicSummary(record, attempts));
}
