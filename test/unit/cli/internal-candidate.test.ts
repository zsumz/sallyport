import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashTarball } from '../../../src/candidate/inspect.ts';
import { validateCandidateReceipt } from '../../../src/candidate/receipt.ts';
import { createCandidateCommand } from '../../../src/cli/internal/create-candidate.ts';
import { packCommand } from '../../../src/cli/internal/pack.ts';
import { smokeCommand } from '../../../src/cli/internal/smoke.ts';
import {
    createConsumer,
    createEffects,
    FIXTURE_SHA,
    makeTempRoot,
    readJsonFile,
    readTextFile,
    removeTempRoot,
    type Consumer,
    type TestEffects,
} from './fixture.ts';

const REPOSITORY_ID = '1286348597';
const RUN_ID = '987654321';

let root = '';
let consumer: Consumer;
let outputDir = '';
let harness: TestEffects;

beforeEach(() => {
    root = makeTempRoot('candidate');
    consumer = createConsumer(root);
    outputDir = path.join(root, 'sallyport-out');
    harness = createEffects(root);
});

afterEach(() => {
    removeTempRoot(root);
});

async function pack(): Promise<Record<string, string>> {
    await packCommand(['--consumer', consumer.dir, '--output', outputDir], harness.effects);
    return harness.outputs[0] ?? {};
}

async function smoke(tarball: string): Promise<void> {
    await smokeCommand([
        '--consumer', consumer.dir,
        '--tarball', tarball,
        '--package', consumer.name,
        '--version', consumer.version,
        '--dist-tag', 'latest',
    ], harness.effects);
}

async function createCandidate(overrides: Partial<Record<string, string>> = {}): Promise<void> {
    const values: Record<string, string> = {
        '--consumer': consumer.dir,
        '--tarball': path.join(outputDir, 'package.tgz'),
        '--output': outputDir,
        '--profile': 'standard',
        '--tag': `v${consumer.version}`,
        '--tag-object': consumer.commit,
        '--repository': 'zsumz/fake',
        '--repository-id': REPOSITORY_ID,
        '--default-branch': 'main',
        '--commit': consumer.commit,
        '--signed': 'false',
        '--run-id': RUN_ID,
        '--run-attempt': '1',
        '--sallyport-sha': FIXTURE_SHA,
        ...overrides,
    };
    await createCandidateCommand(
        Object.entries(values).flatMap(([flag, value]) => [flag, value]),
        harness.effects,
    );
}

describe('internal pack', () => {
    it('packs the consumer once and reports the candidate digests', async () => {
        const outputs = await pack();

        const tarball = path.join(outputDir, 'package.tgz');
        const digest = hashTarball(readFileSync(tarball));
        expect(outputs.tarball).toBe(tarball);
        expect(outputs.bytes).toBe(String(digest.bytes));
        expect(outputs.sha256).toBe(digest.sha256);
        expect(outputs.sha512).toBe(digest.sha512);
        expect(outputs.integrity).toBe(digest.integrity);
        expect(path.isAbsolute(outputs.tarball ?? '')).toBe(true);
    });

    it('creates the output directory when it does not exist', async () => {
        await packCommand([
            '--consumer', consumer.dir,
            '--output', path.join(root, 'nested', 'out'),
        ], harness.effects);

        expect(existsSync(path.join(root, 'nested', 'out', 'package.tgz'))).toBe(true);
    });

    it('rejects a tarball whose manifest disagrees with package.json', async () => {
        await pack();
        const stale = path.join(root, 'stale');
        const other = createConsumer(path.join(root, 'other-package'), { name: 'sallyport-other' });

        await packCommand(['--consumer', other.dir, '--output', stale], harness.effects);
        writeFileSync(
            path.join(consumer.dir, 'package.json'),
            readTextFile(path.join(consumer.dir, 'package.json')),
        );
        await expect(packCommand([
            '--consumer', consumer.dir,
            '--output', stale,
        ], harness.effects)).rejects.toThrow(/Candidate tarball already exists/u);
    });
});

describe('internal smoke', () => {
    it('runs release:smoke against a copy and leaves the candidate untouched', async () => {
        const outputs = await pack();
        const tarball = outputs.tarball ?? '';
        const before = hashTarball(readFileSync(tarball));

        await smoke(tarball);

        expect(hashTarball(readFileSync(tarball))).toEqual(before);
        expect(harness.logs.join('\n')).toContain(`smoke ok ${consumer.name}@${consumer.version} latest`);
        expect(harness.logs.join('\n')).toContain('the candidate tarball is unchanged');
    });

    it('hands the smoke script the copy, not the authoritative tarball', async () => {
        const outputs = await pack();
        const inspect = createConsumer(makeTempRoot('smoke-echo'), {
            scripts: {
                'release:check': 'node -e "process.exit(0)"',
                'release:smoke': 'node -e "console.log(process.env.SALLYPORT_TARBALL)"',
            },
        });

        await smokeCommand([
            '--consumer', inspect.dir,
            '--tarball', outputs.tarball ?? '',
            '--package', consumer.name,
            '--version', consumer.version,
            '--dist-tag', 'latest',
        ], harness.effects);

        const echoed = harness.logs.find((line) => line.endsWith('smoke-package.tgz')) ?? '';
        expect(echoed).toContain(path.join('sallyport-smoke', 'smoke-package.tgz'));
        expect(echoed).not.toBe(outputs.tarball);
    });

    it('fails when the smoke script exits nonzero', async () => {
        const outputs = await pack();
        const broken = createConsumer(makeTempRoot('smoke-fail'), {
            scripts: {
                'release:check': 'node -e "process.exit(0)"',
                'release:smoke': 'node -e "process.exit(3)"',
            },
        });

        await expect(smokeCommand([
            '--consumer', broken.dir,
            '--tarball', outputs.tarball ?? '',
            '--package', consumer.name,
            '--version', consumer.version,
            '--dist-tag', 'latest',
        ], harness.effects)).rejects.toThrow(/Candidate smoke failed/u);
    });

    it('fails when the smoke script mutates its copy of the tarball', async () => {
        const outputs = await pack();
        const mutating = createConsumer(makeTempRoot('smoke-mutate'), {
            scripts: {
                'release:check': 'node -e "process.exit(0)"',
                'release:smoke':
                    'node -e "require(\'node:fs\').appendFileSync(process.env.SALLYPORT_TARBALL, \'x\')"',
            },
        });

        await expect(smokeCommand([
            '--consumer', mutating.dir,
            '--tarball', outputs.tarball ?? '',
            '--package', consumer.name,
            '--version', consumer.version,
            '--dist-tag', 'latest',
        ], harness.effects)).rejects.toThrow(/sha256 changed/u);
    });
});

describe('internal create-candidate', () => {
    it('writes a valid receipt describing the packed candidate', async () => {
        const outputs = await pack();
        await smoke(outputs.tarball ?? '');

        await createCandidate();

        const receiptFile = path.join(outputDir, 'candidate.json');
        const text = readTextFile(receiptFile);
        const receipt = readJsonFile(receiptFile) as Record<string, unknown>;
        expect(validateCandidateReceipt(receipt)).toEqual([]);
        expect(text.endsWith('\n')).toBe(true);
        expect(text).toContain('\n  "schema": 1,');
        expect(text).toContain('\n    "workflow": "zsumz/sallyport');
        expect(receipt).toMatchObject({
            schema: 1,
            protocol: 'sallyport/0.1',
            sallyport: {
                workflow: 'zsumz/sallyport/.github/workflows/stage.yml',
                sha: FIXTURE_SHA,
            },
            repository: { name: 'zsumz/fake', id: 1286348597, defaultBranch: 'main' },
            source: {
                tag: 'v1.2.3',
                tagObject: consumer.commit,
                commit: consumer.commit,
                signed: false,
                signerFingerprint: null,
            },
            package: { name: consumer.name, version: consumer.version, access: 'public', distTag: 'latest' },
            tarball: { filename: 'package.tgz', sha256: outputs.sha256 },
            run: { id: 987654321, attempt: 1 },
        });
    });

    it('rejects a tarball whose packed manifest does not match the clean source', async () => {
        await pack();
        const attackerRoot = makeTempRoot('candidate-forge');
        const attacker = createConsumer(attackerRoot, { name: 'forged-package' });
        const attackerOut = path.join(attackerRoot, 'out');
        await packCommand(['--consumer', attacker.dir, '--output', attackerOut], harness.effects);
        copyFileSync(path.join(attackerOut, 'package.tgz'), path.join(outputDir, 'package.tgz'));

        await expect(createCandidate()).rejects.toThrow(
            /packed package name forged-package does not match sallyport-fixture/u,
        );
        removeTempRoot(attackerRoot);
    });

    it('summarizes the receipt for the workflow step summary', async () => {
        await pack();

        await createCandidate();

        const summary = harness.summaries.join('');
        expect(summary).toContain('### sallyport release candidate');
        expect(summary).toContain(`| Package | \`${consumer.name}@${consumer.version}\` |`);
        expect(summary).toContain('| Signer | `unsigned` |');
        expect(summary).toContain('| Candidate run | 987654321 (attempt 1) |');
    });

    it('re-derives the dist-tag rather than trusting an input', async () => {
        const alphaRoot = makeTempRoot('candidate-alpha');
        const alpha = createConsumer(alphaRoot, { version: '3.0.0-rc.1' });
        const alphaOut = path.join(alphaRoot, 'out');
        await packCommand(['--consumer', alpha.dir, '--output', alphaOut], harness.effects);

        await createCandidateCommand([
            '--consumer', alpha.dir,
            '--tarball', path.join(alphaOut, 'package.tgz'),
            '--output', alphaOut,
            '--profile', 'standard',
            '--tag', 'v3.0.0-rc.1',
            '--tag-object', alpha.commit,
            '--repository', 'zsumz/fake',
            '--repository-id', REPOSITORY_ID,
            '--default-branch', 'main',
            '--commit', alpha.commit,
            '--signed', 'false',
            '--run-id', RUN_ID,
            '--run-attempt', '2',
            '--sallyport-sha', FIXTURE_SHA,
        ], harness.effects);

        const receipt = readJsonFile(path.join(alphaOut, 'candidate.json')) as {
            package: { distTag: string };
        };
        expect(receipt.package.distTag).toBe('rc');
        removeTempRoot(alphaRoot);
    });

    it('records a strict signed receipt with the normalized fingerprint', async () => {
        await pack();

        await createCandidate({
            '--profile': 'strict',
            '--signed': 'true',
            '--signer-fingerprint': 'b58439871cd2a7275b20cc19ec8e4d26598a0373',
        });

        const receipt = readJsonFile(path.join(outputDir, 'candidate.json')) as {
            source: { signed: boolean; signerFingerprint: string };
        };
        expect(receipt.source).toEqual({
            tag: 'v1.2.3',
            tagObject: consumer.commit,
            commit: consumer.commit,
            signed: true,
            signerFingerprint: 'B58439871CD2A7275B20CC19EC8E4D26598A0373',
        });
    });

    it('refuses a signed receipt without a usable fingerprint', async () => {
        await pack();

        await expect(createCandidate({ '--profile': 'strict', '--signed': 'true' }))
            .rejects.toThrow(/--signer-fingerprint must be 40 hexadecimal characters/u);
    });

    it('refuses to mix the strict profile with an unsigned tag', async () => {
        await pack();

        await expect(createCandidate({ '--profile': 'strict' }))
            .rejects.toThrow('the strict profile requires a signed tag.');
    });

    it('refuses to sign a standard profile release', async () => {
        await pack();

        await expect(createCandidate({
            '--signed': 'true',
            '--signer-fingerprint': 'B'.repeat(40),
        })).rejects.toThrow('--signed true requires the strict profile.');
    });

    it('refuses a commit that is not a full 40-character SHA', async () => {
        await pack();

        await expect(createCandidate({ '--commit': 'abc1234' }))
            .rejects.toThrow('--commit must be a full 40-character commit SHA.');
    });

    it('refuses when the staged tarball does not match the packed candidate', async () => {
        await pack();
        const decoy = path.join(root, 'decoy.tgz');
        writeFileSync(decoy, readFileSync(path.join(outputDir, 'package.tgz')));
        writeFileSync(path.join(outputDir, 'package.tgz'), 'tampered');

        await expect(createCandidate({ '--tarball': decoy }))
            .rejects.toThrow(/does not match the packed candidate/u);
    });

    it('refuses when the candidate tarball is absent from the output directory', async () => {
        const outputs = await pack();
        const empty = path.join(root, 'empty-out');

        await expect(createCandidate({
            '--tarball': outputs.tarball ?? '',
            '--output': empty,
        })).rejects.toThrow(/must exist; the candidate is packed exactly once/u);
    });
});
