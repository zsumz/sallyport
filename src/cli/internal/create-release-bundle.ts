import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    validateCandidateReceipt,
    validateReleaseRecord,
    type CandidateReceipt,
    type ReleaseRecord,
} from '../../candidate/receipt.ts';
import {
    CANDIDATE_RECEIPT_NAME,
    CANDIDATE_TARBALL_NAME,
} from '../../github/artifacts.ts';
import { sha256Hex, sha512Hex } from '../../registry/integrity.ts';
import { parseArgv, requireValue } from '../args.ts';
import { ensureDirectory, errorMessage, failure } from '../support.ts';
import type { CliEffects } from './effects.ts';

export const RELEASE_NOTES_FILENAME = 'RELEASE_NOTES.md';
export const RELEASE_RECORD_FILENAME = 'release.json';
export const CHECKSUM_FILENAME = 'SHA256SUMS';
// SHA256SUMS covers every other bundle file; a checksum file cannot list itself.
export const CHECKSUM_MEMBERS = [
    CANDIDATE_TARBALL_NAME,
    CANDIDATE_RECEIPT_NAME,
    RELEASE_RECORD_FILENAME,
    RELEASE_NOTES_FILENAME,
] as const;

interface BundleBytes {
    tarball: Buffer;
    receipt: Buffer;
    release: Buffer;
    notes: Buffer;
}

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

function bundleFailures(bundled: BundleBytes): string[] {
    const failures: string[] = [];
    const release = parseJson(bundled.release, RELEASE_RECORD_FILENAME, failures);
    const receipt = parseJson(bundled.receipt, CANDIDATE_RECEIPT_NAME, failures);
    if (release !== undefined) {
        failures.push(...validateReleaseRecord(release));
    }
    if (receipt !== undefined) {
        failures.push(...validateCandidateReceipt(receipt));
    }
    if (bundled.notes.byteLength === 0) {
        failures.push(`${RELEASE_NOTES_FILENAME} must not be empty.`);
    }
    if (failures.length > 0) {
        return failures;
    }
    return consistencyFailures(
        release as ReleaseRecord,
        receipt as CandidateReceipt,
        bundled,
    );
}

function consistencyFailures(
    release: ReleaseRecord,
    receipt: CandidateReceipt,
    bundled: BundleBytes,
): string[] {
    const failures: string[] = [];
    const receiptDigest = sha256Hex(bundled.receipt);
    if (release.candidateReceiptSha256 !== receiptDigest) {
        failures.push(
            `${RELEASE_RECORD_FILENAME} candidateReceiptSha256 ${release.candidateReceiptSha256}`
            + ` does not match the bundled ${CANDIDATE_RECEIPT_NAME} ${receiptDigest}.`,
        );
    }
    const sha256 = sha256Hex(bundled.tarball);
    const sha512 = sha512Hex(bundled.tarball);
    failures.push(...digestFailure('candidate.sha256', release.candidate.sha256, sha256));
    failures.push(...digestFailure('candidate.sha512', release.candidate.sha512, sha512));
    failures.push(...digestFailure('registry.sha256', release.registry.sha256, sha256));
    failures.push(...digestFailure('registry.sha512', release.registry.sha512, sha512));
    failures.push(...digestFailure('candidate.json tarball.sha256', receipt.tarball.sha256, sha256));
    failures.push(...digestFailure('candidate.json tarball.sha512', receipt.tarball.sha512, sha512));
    failures.push(...match('package.name', receipt.package.name, release.package.name));
    failures.push(...match('package.version', receipt.package.version, release.package.version));
    failures.push(...match('package.distTag', receipt.package.distTag, release.package.distTag));
    failures.push(...match('source.tag', receipt.source.tag, release.source.tag));
    failures.push(...match('source.commit', receipt.source.commit, release.source.commit));
    failures.push(...match('source.repository', receipt.repository.name, release.source.repository));
    return failures;
}

function digestFailure(label: string, declared: string, actual: string): string[] {
    return declared === actual
        ? []
        : [`${label} ${declared} does not match the bundled ${CANDIDATE_TARBALL_NAME} ${actual}.`];
}

function match(label: string, receiptValue: string, releaseValue: string): string[] {
    return receiptValue === releaseValue
        ? []
        : [`${CANDIDATE_RECEIPT_NAME} ${label} ${receiptValue} does not match ${RELEASE_RECORD_FILENAME} ${releaseValue}.`];
}

function parseJson(bytes: Buffer, name: string, failures: string[]): unknown {
    try {
        return JSON.parse(bytes.toString('utf8')) as unknown;
    } catch (error) {
        failures.push(`${name} is not valid json: ${errorMessage(error)}`);
        return undefined;
    }
}
