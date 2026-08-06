import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertCandidateTarball, hashTarball } from '../../../candidate/inspect.ts';
import {
    buildCandidateReceipt,
    CANDIDATE_TARBALL_FILENAME,
} from '../../../candidate/receipt.ts';
import { readPackageMetadata } from '../../../contract/package.ts';
import { deriveDistTag } from '../../../contract/semver.ts';
import {
    optionalValue,
    parseArgv,
    requireBooleanValue,
    requirePositiveInteger,
    requireValue,
} from '../../args.ts';
import { failure, jsonDocument } from '../../support.ts';
import { parseProfile } from '../../template.ts';
import { readsallyportVersion } from '../../version.ts';
import type { CliEffects } from '../effects.ts';
import {
    CANDIDATE_RECEIPT_FILENAME,
    CREATE_CANDIDATE_FLAGS,
    STAGE_WORKFLOW_REFERENCE,
} from './model.ts';
import { assertStagedTarball, requireCommit, signerFingerprint } from './policy.ts';
import { receiptSummary } from './summary.ts';

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
    const tagObject = requireCommit(requireValue(parsed, 'tag-object'), 'tag-object');
    const repository = requireValue(parsed, 'repository');
    const repositoryId = requirePositiveInteger(parsed, 'repository-id');
    const defaultBranch = requireValue(parsed, 'default-branch');
    const commit = requireCommit(requireValue(parsed, 'commit'), 'commit');
    const signed = requireBooleanValue(parsed, 'signed');
    const runId = requirePositiveInteger(parsed, 'run-id');
    const runAttempt = requirePositiveInteger(parsed, 'run-attempt');
    const sallyportSha = requireCommit(requireValue(parsed, 'sallyport-sha'), 'sallyport-sha');
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

    const tarball = await readFile(tarballPath);
    const manifest = assertCandidateTarball(tarball);
    const manifestFailures: string[] = [];
    if (manifest.name !== name) {
        manifestFailures.push(`packed package name ${manifest.name} does not match ${name}.`);
    }
    if (manifest.version !== version) {
        manifestFailures.push(`packed package version ${manifest.version} does not match ${version}.`);
    }
    if (manifestFailures.length > 0) {
        throw failure('Candidate receipt failed:', manifestFailures);
    }
    const digest = hashTarball(tarball);
    await assertStagedTarball(path.join(outputDir, CANDIDATE_TARBALL_FILENAME), digest);

    const receipt = buildCandidateReceipt({
        sallyport: {
            version: await readsallyportVersion(),
            workflow: STAGE_WORKFLOW_REFERENCE,
            sha: sallyportSha,
        },
        repository: { name: repository, id: repositoryId, defaultBranch },
        source: { tag, tagObject, commit, signed, signerFingerprint: fingerprint },
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
