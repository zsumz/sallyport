import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fetchCandidateCommand } from '../../../src/cli/internal/fetch-candidate.ts';
import type { BinaryResponse, JsonResponse } from '../../../src/registry/download.ts';
import {
    buildCandidate,
    buildZip,
    createEffects,
    FIXTURE_REPOSITORY,
    FIXTURE_REPOSITORY_ID,
    FIXTURE_RUN_ID,
    FIXTURE_SHA,
    makeTempRoot,
    OTHER_SHA,
    removeTempRoot,
    type CandidateFixture,
    type TestEffects,
} from './fixture.ts';

const ARCHIVE_URL = 'https://api.github.com/repos/zsumz/fake/actions/artifacts/11/zip';
const RUN_URL = `https://api.github.com/repos/${FIXTURE_REPOSITORY}/actions/runs/${String(FIXTURE_RUN_ID)}`;

let root = '';
let candidate: CandidateFixture;
let outputDir = '';
let harness: TestEffects;
let runOverrides: Record<string, unknown> = {};
let zipFiles: Array<{ name: string; data: Uint8Array }> = [];
let artifactName = '';

beforeEach(() => {
    root = makeTempRoot('fetch');
    candidate = buildCandidate(root);
    outputDir = path.join(root, 'sallyport-candidate');
    runOverrides = {};
    artifactName = [
        'sallyport-candidate',
        candidate.consumer.commit,
        String(candidate.receipt.run.attempt),
    ].join('-');
    zipFiles = [
        { name: 'package.tgz', data: candidate.tarball },
        { name: 'candidate.json', data: candidate.receiptBytes },
    ];
    harness = createEffects(root, { registry: { fetchJson, fetchBuffer } });
});

afterEach(() => {
    removeTempRoot(root);
});

async function fetchJson(url: string): Promise<JsonResponse> {
    if (url === RUN_URL) {
        return Promise.resolve({ status: 200, body: runBody() });
    }
    if (url.startsWith(`${RUN_URL}/artifacts`)) {
        return Promise.resolve({
            status: 200,
            body: {
                artifacts: [{
                    id: 11,
                    name: artifactName,
                    expired: false,
                    size_in_bytes: candidate.tarball.byteLength,
                    archive_download_url: ARCHIVE_URL,
                }],
            },
        });
    }
    return Promise.resolve({ status: 404, body: null });
}

async function fetchBuffer(url: string): Promise<BinaryResponse> {
    if (url === ARCHIVE_URL) {
        return Promise.resolve({ status: 200, body: buildZip(zipFiles) });
    }
    return Promise.resolve({ status: 404, body: new Uint8Array() });
}

function runBody(): Record<string, unknown> {
    return {
        id: FIXTURE_RUN_ID,
        repository: { id: FIXTURE_REPOSITORY_ID, full_name: FIXTURE_REPOSITORY },
        path: '.github/workflows/sallyport.yml',
        event: 'push',
        conclusion: 'success',
        run_attempt: candidate.receipt.run.attempt,
        head_branch: `v${candidate.consumer.version}`,
        head_sha: candidate.consumer.commit,
        ...runOverrides,
    };
}

function args(overrides: Partial<Record<string, string>> = {}): string[] {
    const values: Record<string, string> = {
        '--run-id': String(FIXTURE_RUN_ID),
        '--repository': FIXTURE_REPOSITORY,
        '--repository-id': String(FIXTURE_REPOSITORY_ID),
        '--sallyport-sha': FIXTURE_SHA,
        '--output': outputDir,
        ...overrides,
    };
    return Object.entries(values).flatMap(([flag, value]) => [flag, value]);
}

function withToken(): TestEffects['effects'] {
    return {
        ...harness.effects,
        env: { ...harness.effects.env, GITHUB_TOKEN: 'gh-token' },
    };
}

describe('internal fetch-candidate', () => {
    it('extracts the candidate and reports the receipt values', async () => {
        await fetchCandidateCommand(args(), withToken());

        expect(existsSync(path.join(outputDir, 'package.tgz'))).toBe(true);
        expect(readFileSync(path.join(outputDir, 'candidate.json')))
            .toEqual(candidate.receiptBytes);
        expect(harness.outputs).toEqual([{
            tag: `v${candidate.consumer.version}`,
            tag_object: candidate.receipt.source.tagObject,
            commit: candidate.consumer.commit,
            package_name: candidate.consumer.name,
            package_version: candidate.consumer.version,
            dist_tag: 'latest',
        }]);
    });

    it('requires a GitHub token', async () => {
        await expect(fetchCandidateCommand(args(), harness.effects))
            .rejects.toThrow('GITHUB_TOKEN is not set.');
    });

    it('rejects a run that used a different workflow file', async () => {
        runOverrides = { path: '.github/workflows/release.yml' };

        await expect(fetchCandidateCommand(args(), withToken()))
            .rejects.toThrow(/used .github\/workflows\/release.yml, expected/u);
    });

    it('rejects a run that did not succeed', async () => {
        runOverrides = { conclusion: 'failure' };

        await expect(fetchCandidateCommand(args(), withToken()))
            .rejects.toThrow('Workflow run concluded failure, expected success.');
    });

    it('rejects a run from a different repository', async () => {
        runOverrides = { repository: { id: 42, full_name: 'zsumz/other' } };

        await expect(fetchCandidateCommand(args(), withToken()))
            .rejects.toThrow(/Workflow run repository 42 does not match/u);
    });

    it('rejects a candidate pinned to a different sallyport commit', async () => {
        await expect(fetchCandidateCommand(args({ '--sallyport-sha': OTHER_SHA }), withToken()))
            .rejects.toThrow(/does not match the pinned finalizer/u);
    });

    it('rejects a tampered tarball inside the artifact', async () => {
        zipFiles = [
            { name: 'package.tgz', data: new Uint8Array(Buffer.from('tampered')) },
            { name: 'candidate.json', data: candidate.receiptBytes },
        ];

        await expect(fetchCandidateCommand(args(), withToken()))
            .rejects.toThrow(/artifact tarball sha256 .* does not match the receipt/u);
    });

    it('rejects an artifact that carries extra entries', async () => {
        zipFiles = [
            ...zipFiles,
            { name: 'notes.txt', data: new Uint8Array(Buffer.from('extra')) },
        ];

        await expect(fetchCandidateCommand(args(), withToken()))
            .rejects.toThrow(/unexpected entries: notes.txt/u);
    });

    it('rejects an artifact named for a different commit', async () => {
        artifactName = 'sallyport-candidate-deadbeef';

        await expect(fetchCandidateCommand(args(), withToken()))
            .rejects.toThrow(/is not present on the run/u);
    });

    it('rejects a candidate receipt that fails validation', async () => {
        zipFiles = [
            { name: 'package.tgz', data: candidate.tarball },
            { name: 'candidate.json', data: new Uint8Array(Buffer.from('{"schema":1}')) },
        ];

        await expect(fetchCandidateCommand(args(), withToken()))
            .rejects.toThrow(/protocol must be "sallyport\/0.1"/u);
    });

    it('rejects a malformed sallyport sha argument', async () => {
        await expect(fetchCandidateCommand(args({ '--sallyport-sha': 'main' }), withToken()))
            .rejects.toThrow('--sallyport-sha must be a full 40-character commit SHA.');
    });

    it('reports an unreadable workflow run', async () => {
        await expect(fetchCandidateCommand(args({ '--run-id': '5' }), withToken()))
            .rejects.toThrow(/actions\/runs\/5 returned 404/u);
    });

    it('uses GITHUB_API_URL when the runner supplies one', async () => {
        const effects = {
            ...withToken(),
            env: { ...withToken().env, GITHUB_API_URL: 'https://api.github.com/' },
        };

        await fetchCandidateCommand(args(), effects);

        expect(harness.outputs).toHaveLength(1);
    });
});
