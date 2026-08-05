import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashTarball } from '../../candidate/inspect.ts';
import {
    validateCandidateReceipt,
    type CandidateReceipt,
} from '../../candidate/receipt.ts';
import {
    CANDIDATE_RECEIPT_NAME,
    CANDIDATE_TARBALL_NAME,
    fetchCandidateArtifact,
    GITHUB_API_BASE,
    githubRequest,
    type GithubApiTarget,
} from '../../github/artifacts.ts';
import { CALLER_WORKFLOW_PATH, validateCandidateRun } from '../../github/workflow-run.ts';
import { readStringProperty } from '../../registry/download.ts';
import { parseArgv, requirePositiveInteger, requireValue } from '../args.ts';
import { normalizeCommitSha } from '../pins.ts';
import { ensureDirectory, failure } from '../support.ts';
import type { CliEffects } from './effects.ts';

export const FETCH_CANDIDATE_FLAGS = [
    'run-id',
    'repository',
    'repository-id',
    'quoin-sha',
    'output',
] as const;

export async function fetchCandidateCommand(
    argv: readonly string[],
    effects: CliEffects,
): Promise<void> {
    const parsed = parseArgv(argv, { strings: [...FETCH_CANDIDATE_FLAGS] });
    const runId = requirePositiveInteger(parsed, 'run-id');
    const repository = requireValue(parsed, 'repository');
    const repositoryId = requirePositiveInteger(parsed, 'repository-id');
    const quoinSha = normalizeCommitSha(requireValue(parsed, 'quoin-sha'));
    const outputDir = path.resolve(requireValue(parsed, 'output'));
    if (quoinSha === null) {
        throw new Error(
            'Candidate retrieval failed: --quoin-sha must be a full 40-character commit SHA.',
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
    if (commit === null || normalizeCommitSha(commit) === null) {
        throw failure('Candidate retrieval failed:', [
            `workflow run ${String(runId)} reports no head commit.`,
        ]);
    }

    const files = await fetchCandidateArtifact({
        fetchJson: effects.registry.fetchJson,
        fetchBuffer: effects.registry.fetchBuffer,
        target,
        runId,
        commit,
    });
    const receipt = parseReceipt(files.receipt);
    const failures = validateCandidateRun({
        run,
        expected: {
            repositoryId,
            workflowPath: CALLER_WORKFLOW_PATH,
            quoinSha,
            receipt,
        },
    });
    failures.push(...tarballFailures(files.tarball, receipt));
    if (failures.length > 0) {
        throw failure(`Candidate retrieval failed for run ${String(runId)}:`, failures);
    }

    await ensureDirectory(outputDir);
    await writeFile(path.join(outputDir, CANDIDATE_TARBALL_NAME), files.tarball);
    await writeFile(path.join(outputDir, CANDIDATE_RECEIPT_NAME), files.receipt);

    await effects.writeOutput({
        tag: receipt.source.tag,
        commit: receipt.source.commit,
        package_name: receipt.package.name,
        package_version: receipt.package.version,
        dist_tag: receipt.package.distTag,
    });
    effects.log(
        `Retrieved candidate ${receipt.package.name}@${receipt.package.version}`
        + ` from run ${String(runId)} into ${outputDir}.`,
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

export function parseReceipt(bytes: Uint8Array): CandidateReceipt {
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    } catch {
        throw failure('Candidate retrieval failed:', ['candidate.json is not valid json.']);
    }
    const failures = validateCandidateReceipt(parsed);
    if (failures.length > 0) {
        throw failure('Candidate retrieval failed:', failures);
    }
    return parsed as CandidateReceipt;
}

function tarballFailures(tarball: Uint8Array, receipt: CandidateReceipt): string[] {
    const digest = hashTarball(Buffer.from(tarball));
    const failures: string[] = [];
    if (digest.bytes !== receipt.tarball.bytes) {
        failures.push(
            `artifact tarball is ${String(digest.bytes)} bytes, the receipt records ${String(receipt.tarball.bytes)}.`,
        );
    }
    if (digest.sha256 !== receipt.tarball.sha256) {
        failures.push(
            `artifact tarball sha256 ${digest.sha256} does not match the receipt ${receipt.tarball.sha256}.`,
        );
    }
    if (digest.sha512 !== receipt.tarball.sha512) {
        failures.push(
            `artifact tarball sha512 ${digest.sha512} does not match the receipt ${receipt.tarball.sha512}.`,
        );
    }
    if (digest.integrity !== receipt.tarball.integrity) {
        failures.push(
            `artifact tarball integrity ${digest.integrity} does not match the receipt ${receipt.tarball.integrity}.`,
        );
    }
    return failures;
}
