import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    buildReleaseRecord,
    validateReleaseRecord,
    type ReleaseRecord,
} from '../../../src/candidate/receipt.ts';
import { createReleaseBundleCommand } from '../../../src/cli/internal/create-release-bundle.ts';
import { sha256Hex } from '../../../src/registry/integrity.ts';
import {
    buildCandidate,
    createEffects,
    makeTempRoot,
    readJsonFile,
    readTextFile,
    removeTempRoot,
    writeTextFile,
    type CandidateFixture,
    type TestEffects,
} from './fixture.ts';

// The finalize workflow validator accepts `<hex> <space-or-star><name>`.
const SUM_LINE = /^([0-9a-f]{64}) [ *](.+)$/u;
const BUNDLE_FILES = ['package.tgz', 'candidate.json', 'release.json', 'RELEASE_NOTES.md'];

let root = '';
let candidate: CandidateFixture;
let bundleDir = '';
let releaseFile = '';
let notesFile = '';
let harness: TestEffects;

beforeEach(() => {
    root = makeTempRoot('bundle');
    candidate = buildCandidate(root);
    bundleDir = path.join(root, 'bundle');
    releaseFile = path.join(root, 'public', 'release.json');
    notesFile = path.join(
        candidate.consumer.dir,
        'docs',
        'releases',
        `v${candidate.consumer.version}.md`,
    );
    harness = createEffects(root);
    writeRelease();
});

afterEach(() => {
    removeTempRoot(root);
});

function releaseRecord(): ReleaseRecord {
    const { receipt, digest, receiptBytes } = candidate;
    return buildReleaseRecord({
        candidateReceiptSha256: sha256Hex(receiptBytes),
        package: {
            name: receipt.package.name,
            version: receipt.package.version,
            distTag: receipt.package.distTag,
        },
        candidate: { sha256: digest.sha256, sha512: digest.sha512 },
        registry: {
            sha256: digest.sha256,
            sha512: digest.sha512,
            integrityVerified: true,
            signatureVerified: true,
            provenanceVerified: true,
        },
        source: {
            repository: receipt.repository.name,
            tag: receipt.source.tag,
            commit: receipt.source.commit,
        },
    });
}

function writeRelease(record: ReleaseRecord = releaseRecord()): void {
    writeTextFile(releaseFile, `${JSON.stringify(record, null, 2)}\n`);
}

async function bundle(): Promise<void> {
    await createReleaseBundleCommand([
        '--candidate-dir', candidate.dir,
        '--release', releaseFile,
        '--notes', notesFile,
        '--output', bundleDir,
    ], harness.effects);
}

function sumLines(): Array<[string, string]> {
    return readTextFile(path.join(bundleDir, 'SHA256SUMS'))
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => {
            const match = SUM_LINE.exec(line);
            if (match === null) {
                throw new Error(`malformed SHA256SUMS line: ${line}`);
            }
            return [match[1] ?? '', match[2] ?? ''];
        });
}

describe('internal create-release-bundle', () => {
    it('writes the five bundle files', async () => {
        await bundle();

        for (const name of [...BUNDLE_FILES, 'SHA256SUMS']) {
            expect(existsSync(path.join(bundleDir, name))).toBe(true);
        }
    });

    it('copies the candidate bytes verbatim', async () => {
        await bundle();

        expect(readTextFile(path.join(bundleDir, 'candidate.json')))
            .toBe(candidate.receiptBytes.toString('utf8'));
        expect(validateReleaseRecord(readJsonFile(path.join(bundleDir, 'release.json'))))
            .toEqual([]);
        expect(readTextFile(path.join(bundleDir, 'RELEASE_NOTES.md')))
            .toBe(readTextFile(notesFile));
    });

    it('checksums every other bundle file in sha256sum format', async () => {
        await bundle();

        const lines = sumLines();
        expect(lines.map((entry) => entry[1])).toEqual(BUNDLE_FILES);
        expect(lines[0]?.[0]).toBe(candidate.digest.sha256);
        expect(lines[1]?.[0]).toBe(sha256Hex(candidate.receiptBytes));
        expect(readTextFile(path.join(bundleDir, 'SHA256SUMS')))
            .toContain(`${candidate.digest.sha256}  package.tgz`);
        expect(readTextFile(path.join(bundleDir, 'SHA256SUMS')).endsWith('\n')).toBe(true);
    });

    it('round-trips through the finalize validator expectations', async () => {
        await bundle();

        for (const [digest, name] of sumLines()) {
            expect(sha256Hex(Buffer.from(readTextFile(path.join(bundleDir, name)), 'utf8')).length)
                .toBe(64);
            expect(digest).toMatch(/^[0-9a-f]{64}$/u);
            expect(name).toMatch(/^[A-Za-z0-9._-]+$/u);
        }
    });

    it('rejects a receipt that no longer matches candidateReceiptSha256', async () => {
        writeFileSync(
            path.join(candidate.dir, 'candidate.json'),
            candidate.receiptBytes.toString('utf8').replace('"attempt": 1', '"attempt": 2'),
        );

        await expect(bundle()).rejects.toThrow(/candidateReceiptSha256 .* does not match/u);
    });

    it('rejects a tarball that does not match the release record', async () => {
        writeFileSync(path.join(candidate.dir, 'package.tgz'), 'tampered');

        await expect(bundle()).rejects.toThrow(/candidate.sha256 .* does not match the bundled/u);
    });

    it('rejects a release record whose package disagrees with the receipt', async () => {
        const record = releaseRecord();
        writeRelease({
            ...record,
            package: { ...record.package, distTag: 'next' },
        });

        await expect(bundle()).rejects.toThrow(/package.distTag latest does not match/u);
    });

    it('rejects a release record that fails schema validation', async () => {
        writeTextFile(releaseFile, '{"schema":2}\n');

        await expect(bundle()).rejects.toThrow(/protocol must be "quoin\/0.1"/u);
    });

    it('rejects release json that does not parse', async () => {
        writeTextFile(releaseFile, 'not json');

        await expect(bundle()).rejects.toThrow(/release.json is not valid json/u);
    });

    it('rejects empty release notes', async () => {
        writeTextFile(notesFile, '');

        await expect(bundle()).rejects.toThrow('RELEASE_NOTES.md must not be empty.');
    });

    it('reports a missing input file by name', async () => {
        await expect(createReleaseBundleCommand([
            '--candidate-dir', candidate.dir,
            '--release', path.join(root, 'nowhere.json'),
            '--notes', notesFile,
            '--output', bundleDir,
        ], harness.effects)).rejects.toThrow(/release.json could not be read/u);
    });
});
