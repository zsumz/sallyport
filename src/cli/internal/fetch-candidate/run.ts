import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isFamilyCandidateReceipt } from '../../../candidate/receipt.ts';
import {
    CANDIDATE_RECEIPT_NAME,
    fetchCandidateArtifact,
    GITHUB_API_BASE,
    githubRequest,
    type GithubApiTarget,
} from '../../../github/artifacts.ts';
import { CALLER_WORKFLOW_PATH, validateCandidateRun } from '../../../github/workflow-run.ts';
import { readNumberProperty, readStringProperty } from '../../../registry/download.ts';
import { parseArgv, requirePositiveInteger, requireValue } from '../../args.ts';
import { normalizeCommitSha } from '../../pins.ts';
import { ensureDirectory, failure } from '../../support.ts';
import type { CliEffects } from '../effects.ts';
import { FETCH_CANDIDATE_FLAGS } from './model.ts';
import { parseReceipt, tarballFailures } from './validate.ts';

export async function fetchCandidateCommand(
    argv: readonly string[],
    effects: CliEffects,
): Promise<void> {
    const parsed = parseArgv(argv, { strings: [...FETCH_CANDIDATE_FLAGS] });
    const runId = requirePositiveInteger(parsed, 'run-id');
    const repository = requireValue(parsed, 'repository');
    const repositoryId = requirePositiveInteger(parsed, 'repository-id');
    const sallyportSha = normalizeCommitSha(requireValue(parsed, 'sallyport-sha'));
    const outputDir = path.resolve(requireValue(parsed, 'output'));
    if (sallyportSha === null) {
        throw new Error(
            'Candidate retrieval failed: --sallyport-sha must be a full 40-character commit SHA.',
        );
    }
    const token = effects.env.GITHUB_TOKEN ?? '';
    if (token === '') {
        throw new Error('Candidate retrieval failed: GITHUB_TOKEN is not set.');
    }
    const target: GithubApiTarget = {
        apiBase: effects.env.GITHUB_API_URL ?? GITHUB_API_BASE,
        repository,
        token,
    };

    const run = await fetchWorkflowRun(effects, target, runId);
    const commit = readStringProperty(run, 'head_sha');
    const runAttempt = readNumberProperty(run, 'run_attempt');
    if (commit === null || normalizeCommitSha(commit) === null) {
        throw failure('Candidate retrieval failed:', [
            `workflow run ${String(runId)} reports no head commit.`,
        ]);
    }
    if (runAttempt === null || !Number.isSafeInteger(runAttempt) || runAttempt < 1) {
        throw failure('Candidate retrieval failed:', [
            `workflow run ${String(runId)} reports no valid attempt.`,
        ]);
    }

    const files = await fetchCandidateArtifact({
        fetchJson: effects.registry.fetchJson,
        fetchBuffer: effects.registry.fetchBuffer,
        target,
        runId,
        runAttempt,
        commit,
    });
    const receipt = parseReceipt(files.receipt);
    const failures = validateCandidateRun({
        run,
        expected: {
            repositoryId,
            workflowPath: CALLER_WORKFLOW_PATH,
            sallyportSha,
            receipt,
        },
    });
    failures.push(...tarballFailures(files.tarballs, receipt));
    if (failures.length > 0) {
        throw failure('Candidate retrieval failed for run ' + String(runId) + ':', failures);
    }

    await ensureDirectory(outputDir);
    for (const [filename, bytes] of files.tarballs) {
        await writeFile(path.join(outputDir, filename), bytes);
    }
    await writeFile(path.join(outputDir, CANDIDATE_RECEIPT_NAME), files.receipt);

    const release = isFamilyCandidateReceipt(receipt)
        ? receipt.family
        : {
            name: receipt.package.name,
            version: receipt.package.version,
            distTag: receipt.package.distTag,
        };
    const outputs: Record<string, string> = {
        tag: receipt.source.tag,
        tag_object: receipt.source.tagObject,
        commit: receipt.source.commit,
        package_name: release.name,
        package_version: release.version,
        dist_tag: release.distTag,
    };
    if (isFamilyCandidateReceipt(receipt)) {
        outputs.package_count = String(receipt.packages.length);
    }
    await effects.writeOutput(outputs);
    effects.log(
        'Retrieved candidate ' + release.name + '@' + release.version
        + ' from run ' + String(runId) + ' into ' + outputDir + '.',
    );
}

async function fetchWorkflowRun(
    effects: CliEffects,
    target: GithubApiTarget,
    runId: number,
): Promise<unknown> {
    const base = target.apiBase.endsWith('/') ? target.apiBase.slice(0, -1) : target.apiBase;
    const url = `${base}/repos/${target.repository}/actions/runs/${String(runId)}`;
    const response = await effects.registry.fetchJson(url, githubRequest(target.token, 'GET'));
    if (response.status !== 200) {
        throw new Error(
            `Candidate retrieval failed: ${url} returned ${String(response.status)}.`,
        );
    }
    return response.body;
}
