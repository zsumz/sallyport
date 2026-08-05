import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashTarball, type TarballDigest } from '../../candidate/inspect.ts';
import {
    buildCandidateReceipt,
    CANDIDATE_TARBALL_FILENAME,
    type CandidateReceipt,
} from '../../candidate/receipt.ts';
import { readPackageMetadata } from '../../contract/package.ts';
import { deriveDistTag } from '../../contract/semver.ts';
import { normalizeFingerprint } from '../../contract/signing.ts';
import {
    optionalValue,
    parseArgv,
    requireBooleanValue,
    requirePositiveInteger,
    requireValue,
} from '../args.ts';
import { normalizeCommitSha } from '../pins.ts';
import { failure, jsonDocument } from '../support.ts';
import { parseProfile, type Profile } from '../template.ts';
import { readQuoinVersion } from '../version.ts';
import type { CliEffects } from './effects.ts';

// The receipt always names the reusable workflow without a ref; the pinned
// commit is recorded separately as quoin.sha.
export const STAGE_WORKFLOW_REFERENCE = 'zsumz/quoin/.github/workflows/stage.yml';
export const CANDIDATE_RECEIPT_FILENAME = 'candidate.json';

export const CREATE_CANDIDATE_FLAGS = [
    'consumer',
    'tarball',
    'output',
    'profile',
    'tag',
    'repository',
    'repository-id',
    'default-branch',
    'commit',
    'signed',
    'signer-fingerprint',
    'run-id',
    'run-attempt',
    'quoin-sha',
] as const;

export async function createCandidateCommand(
    argv: readonly string[],
    effects: CliEffects,
): Promise<void> {
    const parsed = parseArgv(argv, { strings: [...CREATE_CANDIDATE_FLAGS] });
    const consumerDir = path.resolve(requireValue(parsed, 'consumer'));
    const tarballPath = path.resolve(requireValue(parsed, 'tarball'));
    const outputDir = path.resolve(requireValue(parsed, 'output'));
    const profile = parseProfile(requireValue(parsed, 'profile'));
    const tag = requireValue(parsed, 'tag');
    const repository = requireValue(parsed, 'repository');
    const repositoryId = requirePositiveInteger(parsed, 'repository-id');
    const defaultBranch = requireValue(parsed, 'default-branch');
    const commit = requireCommit(requireValue(parsed, 'commit'), 'commit');
    const signed = requireBooleanValue(parsed, 'signed');
    const runId = requirePositiveInteger(parsed, 'run-id');
    const runAttempt = requirePositiveInteger(parsed, 'run-attempt');
    const quoinSha = requireCommit(requireValue(parsed, 'quoin-sha'), 'quoin-sha');
    const fingerprint = signerFingerprint(
        signed,
        profile,
        optionalValue(parsed, 'signer-fingerprint'),
    );

    const metadata = await readPackageMetadata(consumerDir);
    const name = metadata.name;
    const version = metadata.version;
    if (name === undefined || version === undefined) {
        throw failure('Candidate receipt failed:', [
            'package.json must declare both a name and a version.',
        ]);
    }
    const decision = deriveDistTag(version);
    if ('error' in decision) {
        throw failure('Candidate receipt failed:', [decision.error]);
    }

    const digest = hashTarball(await readFile(tarballPath));
    const staged = path.join(outputDir, CANDIDATE_TARBALL_FILENAME);
    await assertStagedTarball(staged, digest);

    const receipt = buildCandidateReceipt({
        quoin: {
            version: await readQuoinVersion(),
            workflow: STAGE_WORKFLOW_REFERENCE,
            sha: quoinSha,
        },
        repository: { name: repository, id: repositoryId, defaultBranch },
        source: { tag, commit, signed, signerFingerprint: fingerprint },
        package: { name, version, distTag: decision.distTag },
        tarball: {
            bytes: digest.bytes,
            sha256: digest.sha256,
            sha512: digest.sha512,
            integrity: digest.integrity,
        },
        run: { id: runId, attempt: runAttempt },
    });

    const receiptPath = path.join(outputDir, CANDIDATE_RECEIPT_FILENAME);
    await writeFile(receiptPath, jsonDocument(receipt));
    await effects.writeSummary(receiptSummary(receipt, profile));
    effects.log(`Wrote ${receiptPath}.`);
}

function requireCommit(value: string, flag: string): string {
    const normalized = normalizeCommitSha(value);
    if (normalized === null) {
        throw new Error(
            `Candidate receipt failed: --${flag} must be a full 40-character commit SHA.`,
        );
    }
    return normalized;
}

// source.signed comes from the flag alone; the profile is only cross-checked so
// a strict caller can never produce an unsigned receipt.
function signerFingerprint(
    signed: boolean,
    profile: Profile,
    requested: string | undefined,
): string | null {
    if (signed && profile !== 'strict') {
        throw new Error(
            'Candidate receipt failed: --signed true requires the strict profile.',
        );
    }
    if (!signed && profile === 'strict') {
        throw new Error(
            'Candidate receipt failed: the strict profile requires a signed tag.',
        );
    }
    if (!signed) {
        return null;
    }
    const fingerprint = requested === undefined ? null : normalizeFingerprint(requested);
    if (fingerprint === null) {
        throw new Error(
            'Candidate receipt failed: --signer-fingerprint must be 40 hexadecimal characters'
            + ' when the tag is signed.',
        );
    }
    return fingerprint;
}

async function assertStagedTarball(staged: string, digest: TarballDigest): Promise<void> {
    let bytes: Buffer;
    try {
        bytes = await readFile(staged);
    } catch {
        throw failure('Candidate receipt failed:', [
            `${staged} must exist; the candidate is packed exactly once into the output directory.`,
        ]);
    }
    const stagedDigest = hashTarball(bytes);
    if (stagedDigest.sha256 !== digest.sha256 || stagedDigest.sha512 !== digest.sha512) {
        throw failure('Candidate receipt failed:', [
            `${staged} sha256 ${stagedDigest.sha256} does not match the packed candidate ${digest.sha256}.`,
        ]);
    }
}

function receiptSummary(receipt: CandidateReceipt, profile: Profile): string {
    return [
        '### quoin release candidate',
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| Package | \`${receipt.package.name}@${receipt.package.version}\` |`,
        `| Dist-tag | \`${receipt.package.distTag}\` |`,
        `| Access | \`${receipt.package.access}\` |`,
        `| Tag | \`${receipt.source.tag}\` |`,
        `| Commit | \`${receipt.source.commit}\` |`,
        `| Repository | \`${receipt.repository.name}\` (${String(receipt.repository.id)}) |`,
        `| Default branch | \`${receipt.repository.defaultBranch}\` |`,
        `| Profile | \`${profile}\` |`,
        `| Signer | \`${receipt.source.signerFingerprint ?? 'unsigned'}\` |`,
        `| Candidate SHA-256 | \`${receipt.tarball.sha256}\` |`,
        `| Candidate bytes | ${String(receipt.tarball.bytes)} |`,
        `| Integrity | \`${receipt.tarball.integrity}\` |`,
        `| quoin | \`${receipt.quoin.version}\` @ \`${receipt.quoin.sha}\` |`,
        `| Candidate run | ${String(receipt.run.id)} (attempt ${String(receipt.run.attempt)}) |`,
        '',
    ].join('\n');
}
