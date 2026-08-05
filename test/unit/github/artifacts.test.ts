import { Buffer } from 'node:buffer';
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
    candidateArtifactName,
    downloadArtifactZip,
    extractCandidateArtifact,
    fetchCandidateArtifact,
    isSafeEntryName,
    listRunArtifacts,
    readZipEntries,
    selectCandidateArtifact,
    type GithubApiTarget,
    type RunArtifact,
} from '../../../src/github/artifacts.ts';
import type { FetchBuffer, FetchJson } from '../../../src/registry/download.ts';

const COMMIT = 'b'.repeat(40);
const RUN_ATTEMPT = 2;
const ARTIFACT_NAME = `sallyport-candidate-${COMMIT}-${String(RUN_ATTEMPT)}`;
const TARBALL = new Uint8Array(Buffer.from('a fake gzipped npm tarball'));
const RECEIPT = new Uint8Array(Buffer.from('{"schema":1,"protocol":"sallyport/0.1"}'));

const STORED = 0;
const DEFLATED = 8;

interface ZipFile {
    name: string;
    data: Uint8Array;
    method: number;
    crcOverride?: number;
}

function buildZip(files: readonly ZipFile[]): Uint8Array {
    const body: Buffer[] = [];
    const directory: Buffer[] = [];
    let offset = 0;
    for (const file of files) {
        const name = Buffer.from(file.name, 'utf8');
        const stored = file.method === DEFLATED
            ? deflateRawSync(file.data)
            : Buffer.from(file.data);
        const checksum = file.crcOverride ?? crc32(Buffer.from(file.data));
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(file.method, 8);
        local.writeUInt32LE(0, 10);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(stored.length, 18);
        local.writeUInt32LE(file.data.byteLength, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        body.push(local, name, stored);

        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(20, 6);
        header.writeUInt16LE(0, 8);
        header.writeUInt16LE(file.method, 10);
        header.writeUInt32LE(0, 12);
        header.writeUInt32LE(checksum, 16);
        header.writeUInt32LE(stored.length, 20);
        header.writeUInt32LE(file.data.byteLength, 24);
        header.writeUInt16LE(name.length, 28);
        header.writeUInt16LE(0, 30);
        header.writeUInt16LE(0, 32);
        header.writeUInt16LE(0, 34);
        header.writeUInt16LE(0, 36);
        header.writeUInt32LE(0, 38);
        header.writeUInt32LE(offset, 42);
        directory.push(header, name);
        offset += local.length + name.length + stored.length;
    }
    const central = Buffer.concat(directory);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return new Uint8Array(Buffer.concat([...body, central, end]));
}

function candidateZip(method = DEFLATED): Uint8Array {
    return buildZip([
        { name: 'package.tgz', data: TARBALL, method },
        { name: 'candidate.json', data: RECEIPT, method },
    ]);
}

function target(): GithubApiTarget {
    return {
        apiBase: 'https://api.github.com',
        repository: 'zsumz/demo',
        token: 'gh-token',
    };
}

function artifact(overrides: Partial<RunArtifact> = {}): RunArtifact {
    return {
        id: 11,
        name: ARTIFACT_NAME,
        expired: false,
        sizeInBytes: 4096,
        archiveDownloadUrl: 'https://api.github.com/repos/zsumz/demo/actions/artifacts/11/zip',
        ...overrides,
    };
}

describe('readZipEntries', () => {
    it('round-trips deflated entries', () => {
        expect(readZipEntries(candidateZip(DEFLATED))).toStrictEqual([
            { name: 'package.tgz', data: TARBALL },
            { name: 'candidate.json', data: RECEIPT },
        ]);
    });

    it('round-trips stored entries', () => {
        expect(readZipEntries(candidateZip(STORED))).toStrictEqual([
            { name: 'package.tgz', data: TARBALL },
            { name: 'candidate.json', data: RECEIPT },
        ]);
    });

    it('reads an empty archive', () => {
        expect(readZipEntries(buildZip([]))).toStrictEqual([]);
    });

    it('rejects a truncated archive', () => {
        expect(() => readZipEntries(new Uint8Array(8)))
            .toThrow('the archive is too small');
    });

    it('rejects an archive without an end of central directory record', () => {
        expect(() => readZipEntries(new Uint8Array(64)))
            .toThrow('the end of central directory record was not found');
    });

    it('rejects a corrupted entry', () => {
        const zip = buildZip([
            { name: 'package.tgz', data: TARBALL, method: STORED, crcOverride: 1 },
        ]);
        expect(() => readZipEntries(zip)).toThrow('failed its CRC check');
    });

    it('rejects an unsupported compression method', () => {
        const zip = buildZip([{ name: 'package.tgz', data: TARBALL, method: 12 }]);
        expect(() => readZipEntries(zip)).toThrow('unsupported compression method 12');
    });

    it('rejects unsafe entry names', () => {
        for (const name of ['../evil.tgz', '/etc/passwd', 'a/../../b', './x', 'C:evil']) {
            expect(isSafeEntryName(name)).toBe(false);
            expect(() => readZipEntries(buildZip([{ name, data: TARBALL, method: STORED }])))
                .toThrow('unsafe entry name');
        }
    });

    it('accepts ordinary relative names', () => {
        expect(isSafeEntryName('package.tgz')).toBe(true);
        expect(isSafeEntryName('nested/package.tgz')).toBe(true);
        expect(isSafeEntryName('')).toBe(false);
    });
});

describe('extractCandidateArtifact', () => {
    it('extracts exactly package.tgz and candidate.json', () => {
        expect(extractCandidateArtifact(candidateZip())).toStrictEqual({
            tarball: TARBALL,
            receipt: RECEIPT,
        });
    });

    it('rejects any additional entry', () => {
        const zip = buildZip([
            { name: 'package.tgz', data: TARBALL, method: STORED },
            { name: 'candidate.json', data: RECEIPT, method: STORED },
            { name: 'notes.md', data: RECEIPT, method: STORED },
        ]);
        expect(() => extractCandidateArtifact(zip))
            .toThrow('unexpected entries: notes.md');
    });

    it('rejects a missing candidate receipt', () => {
        const zip = buildZip([{ name: 'package.tgz', data: TARBALL, method: STORED }]);
        expect(() => extractCandidateArtifact(zip))
            .toThrow('must contain package.tgz and candidate.json');
    });

    it('rejects duplicate entries', () => {
        const zip = buildZip([
            { name: 'package.tgz', data: TARBALL, method: STORED },
            { name: 'package.tgz', data: RECEIPT, method: STORED },
            { name: 'candidate.json', data: RECEIPT, method: STORED },
        ]);
        expect(() => extractCandidateArtifact(zip)).toThrow('duplicate entries');
    });
});

describe('selectCandidateArtifact', () => {
    it('derives the artifact name from the tag commit', () => {
        expect(candidateArtifactName(COMMIT, RUN_ATTEMPT)).toBe(ARTIFACT_NAME);
    });

    it('finds the candidate artifact', () => {
        expect(selectCandidateArtifact(
            [artifact({ name: 'other' }), artifact()],
            COMMIT,
            RUN_ATTEMPT,
        ).id)
            .toBe(11);
    });

    it('rejects a missing artifact', () => {
        expect(() => selectCandidateArtifact(
            [artifact({ name: 'other' })],
            COMMIT,
            RUN_ATTEMPT,
        ))
            .toThrow('is not present on the run');
    });

    it('rejects an expired artifact', () => {
        expect(() => selectCandidateArtifact(
            [artifact({ expired: true })],
            COMMIT,
            RUN_ATTEMPT,
        ))
            .toThrow('has expired');
    });

    it('rejects duplicate artifacts', () => {
        expect(() => selectCandidateArtifact(
            [artifact(), artifact({ id: 12 })],
            COMMIT,
            RUN_ATTEMPT,
        ))
            .toThrow('is present 2 times');
    });
});

describe('listRunArtifacts', () => {
    it('requests the run artifacts with the bearer token', async () => {
        const seen: Array<{ url: string; headers: Readonly<Record<string, string>> }> = [];
        const fetchJson: FetchJson = async (url, request) => {
            seen.push({ url, headers: request?.headers ?? {} });
            return Promise.resolve({
                status: 200,
                body: {
                    total_count: 1,
                    artifacts: [{
                        id: 11,
                        name: ARTIFACT_NAME,
                        expired: false,
                        size_in_bytes: 4096,
                        archive_download_url: artifact().archiveDownloadUrl,
                    }],
                },
            });
        };
        const artifacts = await listRunArtifacts(fetchJson, target(), 555);
        expect(artifacts).toStrictEqual([artifact()]);
        expect(seen[0]?.url).toBe(
            'https://api.github.com/repos/zsumz/demo/actions/runs/555/artifacts?per_page=100',
        );
        expect(seen[0]?.headers.authorization).toBe('Bearer gh-token');
    });

    it('throws on a failing status', async () => {
        const fetchJson: FetchJson = async () => Promise.resolve({ status: 403, body: null });
        await expect(listRunArtifacts(fetchJson, target(), 555)).rejects.toThrow('returned 403');
    });

    it('throws when the response carries no artifact list', async () => {
        const fetchJson: FetchJson = async () => Promise.resolve({ status: 200, body: {} });
        await expect(listRunArtifacts(fetchJson, target(), 555))
            .rejects.toThrow('returned no artifact list');
    });

    it('throws when an artifact entry is unreadable', async () => {
        const fetchJson: FetchJson = async () => Promise.resolve({
            status: 200,
            body: { artifacts: [{ name: ARTIFACT_NAME }] },
        });
        await expect(listRunArtifacts(fetchJson, target(), 555))
            .rejects.toThrow('unreadable workflow run artifact');
    });
});

describe('downloadArtifactZip', () => {
    it('downloads the archive', async () => {
        const fetchBuffer: FetchBuffer = async () => Promise.resolve({
            status: 200,
            body: candidateZip(),
        });
        await expect(downloadArtifactZip(fetchBuffer, target(), artifact()))
            .resolves.toStrictEqual(candidateZip());
    });

    it('refuses a download URL served by another origin', async () => {
        const fetchBuffer: FetchBuffer = async () => Promise.resolve({
            status: 200,
            body: candidateZip(),
        });
        const foreign = artifact({ archiveDownloadUrl: 'https://evil.example.com/zip' });
        await expect(downloadArtifactZip(fetchBuffer, target(), foreign))
            .rejects.toThrow('is not served by https://api.github.com');
    });

    it('throws on a failing status', async () => {
        const fetchBuffer: FetchBuffer = async () => Promise.resolve({
            status: 410,
            body: new Uint8Array(),
        });
        await expect(downloadArtifactZip(fetchBuffer, target(), artifact()))
            .rejects.toThrow('returned 410');
    });
});

describe('fetchCandidateArtifact', () => {
    it('lists, downloads and unpacks the candidate', async () => {
        const fetchJson: FetchJson = async () => Promise.resolve({
            status: 200,
            body: {
                artifacts: [{
                    id: 11,
                    name: ARTIFACT_NAME,
                    expired: false,
                    size_in_bytes: 4096,
                    archive_download_url: artifact().archiveDownloadUrl,
                }],
            },
        });
        const fetchBuffer: FetchBuffer = async () => Promise.resolve({
            status: 200,
            body: candidateZip(),
        });
        await expect(fetchCandidateArtifact({
            fetchJson,
            fetchBuffer,
            target: target(),
            runId: 555,
            runAttempt: RUN_ATTEMPT,
            commit: COMMIT,
        })).resolves.toStrictEqual({ tarball: TARBALL, receipt: RECEIPT });
    });
});
