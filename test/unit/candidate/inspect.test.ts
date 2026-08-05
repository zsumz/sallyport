import { describe, expect, it } from 'vitest';
import {
    assertCandidateTarball,
    hashTarball,
    inspectCandidateTarball,
    listTarballEntries,
    verifyTarballUnchanged,
} from '../../../src/candidate/inspect.ts';
import {
    candidateTarball,
    directoryEntry,
    fileEntry,
    GNU_MAGIC,
    gzipArchive,
    longLinkEntry,
    longNameEntry,
    manifest,
    NUL,
    paxEntry,
    tarArchive,
    tarEntry,
} from './tar-fixture.ts';

const KNOWN_VECTOR = Buffer.from([0, 1, 2, 3, 4]);
const KNOWN_SHA256 = '08bb5e5d6eaac1049ede0893d30ed022b1a4d9b5b48db414871f51c9cb35283d';
const KNOWN_SHA512 = 'b7b70a0b14d7fa213c6ccd3cbffc8bb8f8e11a85f1113b0eb26a00208f2b9b3a'
    + '1dd4aaf39962861e16ab062274342a1ce1f9dba3654f36fc338245589f296c28';
const KNOWN_INTEGRITY = 'sha512-t7cKCxTX+iE8bM08v/yLuPjhGoXxETsOsmoAII8rmzod1KrzmWKGHharBiJ0NCo'
    + 'c4fnbo2VPNvwzgkVYnylsKA==';

function unsafeEntryFailures(entry: Buffer): string[] {
    const archive = tarArchive([
        fileEntry({ path: 'package/package.json', content: manifest('fixture', '1.0.0') }),
        entry,
    ]);
    return inspectCandidateTarball(gzipArchive(archive)).failures;
}

describe('listTarballEntries', () => {
    it('lists files and directories from a gzipped tar archive', () => {
        const archive = tarArchive([
            directoryEntry('package/'),
            fileEntry({ path: 'package/package.json', content: manifest('fixture', '1.0.0') }),
            fileEntry({ path: 'package/dist/index.js', content: 'export const x = 1;\n' }),
        ]);

        const entries = listTarballEntries(gzipArchive(archive));

        expect(entries).toEqual([
            { path: 'package/', type: 'directory', size: 0 },
            {
                path: 'package/package.json',
                type: 'file',
                size: manifest('fixture', '1.0.0').length,
            },
            { path: 'package/dist/index.js', type: 'file', size: 20 },
        ]);
    });

    it('joins the ustar prefix field with the entry name', () => {
        const prefix = `package/${'nested'.padEnd(120, '-')}`;
        const archive = tarArchive([
            tarEntry({ name: 'index.js', prefix }, Buffer.from('x', 'utf8')),
        ]);

        expect(listTarballEntries(gzipArchive(archive))).toEqual([
            { path: `${prefix}/index.js`, type: 'file', size: 1 },
        ]);
    });

    it('ignores the prefix field for GNU-format headers', () => {
        const archive = tarArchive([
            tarEntry(
                { name: 'package/index.js', prefix: 'ignored', magic: GNU_MAGIC },
                Buffer.from('x', 'utf8'),
            ),
        ]);

        expect(listTarballEntries(gzipArchive(archive))).toEqual([
            { path: 'package/index.js', type: 'file', size: 1 },
        ]);
    });

    it('applies a pax path override to the following entry only', () => {
        const longPath = `package/${'deep/'.repeat(30)}index.js`;
        const archive = tarArchive([
            paxEntry([['path', longPath]]),
            fileEntry({ path: 'package/placeholder', content: 'x' }),
            fileEntry({ path: 'package/second.js', content: 'y' }),
        ]);

        expect(listTarballEntries(gzipArchive(archive))).toEqual([
            { path: longPath, type: 'file', size: 1 },
            { path: 'package/second.js', type: 'file', size: 1 },
        ]);
    });

    it('applies a pax global header override', () => {
        const archive = tarArchive([
            paxEntry([['path', 'package/renamed.js']], 'g'),
            fileEntry({ path: 'package/placeholder', content: 'x' }),
        ]);

        expect(listTarballEntries(gzipArchive(archive))).toEqual([
            { path: 'package/renamed.js', type: 'file', size: 1 },
        ]);
    });

    it('applies a pax size override to the following entry', () => {
        const archive = tarArchive([
            paxEntry([['size', '3']]),
            tarEntry({ name: 'package/short.txt', size: 3 }, Buffer.from('abc', 'utf8')),
        ]);

        expect(listTarballEntries(gzipArchive(archive))).toEqual([
            { path: 'package/short.txt', type: 'file', size: 3 },
        ]);
    });

    it('applies GNU long name entries', () => {
        const longPath = `package/${'a'.repeat(150)}.js`;
        const archive = tarArchive([
            longNameEntry(longPath),
            fileEntry({ path: 'package/placeholder', content: 'z' }),
        ]);

        expect(listTarballEntries(gzipArchive(archive))).toEqual([
            { path: longPath, type: 'file', size: 1 },
        ]);
    });

    it('reads GNU base-256 encoded sizes', () => {
        const content = Buffer.alloc(600, 0x61);
        const archive = tarArchive([
            tarEntry({ name: 'package/big.bin', base256Size: true }, content),
        ]);

        expect(listTarballEntries(gzipArchive(archive))).toEqual([
            { path: 'package/big.bin', type: 'file', size: 600 },
        ]);
    });

    it('reports link and device entries as other', () => {
        const archive = tarArchive([
            fileEntry({ path: 'package/link', typeFlag: '2' }),
            fileEntry({ path: 'package/hard', typeFlag: '1' }),
            fileEntry({ path: 'package/device', typeFlag: '3' }),
        ]);

        expect(listTarballEntries(gzipArchive(archive)).map((entry) => entry.type)).toEqual([
            'other',
            'other',
            'other',
        ]);
    });

    it('rejects input that is not gzip data', () => {
        expect(() => listTarballEntries(Buffer.from('definitely not gzip', 'utf8')))
            .toThrow(/not valid gzip data/u);
    });

    it('rejects an archive truncated inside entry data', () => {
        const archive = tarArchive([
            tarEntry({ name: 'package/big.bin' }, Buffer.alloc(600, 0x61)),
        ]);

        expect(() => listTarballEntries(gzipArchive(archive.subarray(0, 1000))))
            .toThrow(/truncated: incomplete tar entry data/u);
    });

    it('rejects an archive truncated inside a header block', () => {
        const archive = tarArchive([
            tarEntry({ name: 'package/big.bin' }, Buffer.alloc(600, 0x61)),
        ]);

        expect(() => listTarballEntries(gzipArchive(archive.subarray(0, 1736))))
            .toThrow(/truncated: incomplete tar header block/u);
    });

    it('rejects an archive without an end-of-archive marker', () => {
        const archive = tarArchive([fileEntry({ path: 'package/index.js', content: 'x' })], 0);

        expect(() => listTarballEntries(gzipArchive(archive)))
            .toThrow(/missing end-of-archive marker/u);
    });

    it('rejects a header with an invalid checksum', () => {
        const archive = tarArchive([
            tarEntry({ name: 'package/index.js', corruptChecksum: true }, Buffer.from('x')),
        ]);

        expect(() => listTarballEntries(gzipArchive(archive)))
            .toThrow(/invalid checksum/u);
    });

    it('consumes GNU long link entries without emitting them', () => {
        const archive = tarArchive([
            longLinkEntry('package/target.js'),
            fileEntry({ path: 'package/link', typeFlag: '2' }),
        ]);

        expect(listTarballEntries(gzipArchive(archive))).toEqual([
            { path: 'package/link', type: 'other', size: 0 },
        ]);
    });

    it('rejects a header whose checksum field is unreadable', () => {
        const entry = tarEntry({ name: 'package/index.js' }, Buffer.from('x', 'utf8'));
        entry.write('zzzzzzzz', 148, 8, 'latin1');

        expect(() => listTarballEntries(gzipArchive(tarArchive([entry]))))
            .toThrow(/unreadable checksum/u);
    });

    it('rejects a header whose size field is not octal', () => {
        const archive = tarArchive([
            tarEntry({
                name: 'package/index.js',
                rawSizeField: Buffer.from('zzzzzzzzzzz', 'latin1'),
            }),
        ]);

        expect(() => listTarballEntries(gzipArchive(archive)))
            .toThrow(/invalid size field/u);
    });

    it('rejects a negative base-256 size', () => {
        const archive = tarArchive([
            tarEntry({ name: 'package/index.js', rawSizeField: Buffer.alloc(12, 0xff) }),
        ]);

        expect(() => listTarballEntries(gzipArchive(archive)))
            .toThrow(/negative or unsupported base-256 tar size/u);
    });

    it('rejects a base-256 size larger than a safe integer', () => {
        const rawSizeField = Buffer.alloc(12, 0xff);
        rawSizeField.writeUInt8(0x80, 0);
        const archive = tarArchive([tarEntry({ name: 'package/index.js', rawSizeField })]);

        expect(() => listTarballEntries(gzipArchive(archive)))
            .toThrow(/larger than the supported size/u);
    });

    it('rejects a pax size record that is not a number', () => {
        const archive = tarArchive([
            paxEntry([['size', 'huge']]),
            fileEntry({ path: 'package/index.js', content: 'x' }),
        ]);

        expect(() => listTarballEntries(gzipArchive(archive)))
            .toThrow(/pax header with an invalid size record/u);
    });

    it('rejects a pax size record larger than a safe integer', () => {
        const archive = tarArchive([
            paxEntry([['size', '99999999999999999999']]),
            fileEntry({ path: 'package/index.js', content: 'x' }),
        ]);

        expect(() => listTarballEntries(gzipArchive(archive)))
            .toThrow(/larger than the supported size/u);
    });

    it('rejects a pax header without a record separator', () => {
        const archive = tarArchive([
            tarEntry({ name: 'PaxHeaders.0/entry', typeFlag: 'x' }, Buffer.from('nospace')),
            fileEntry({ path: 'package/index.js', content: 'x' }),
        ]);

        expect(() => listTarballEntries(gzipArchive(archive)))
            .toThrow(/malformed pax extended header/u);
    });

    it('rejects a pax record without a keyword', () => {
        const archive = tarArchive([
            tarEntry({ name: 'PaxHeaders.0/entry', typeFlag: 'x' }, Buffer.from('8 pathx\n')),
            fileEntry({ path: 'package/index.js', content: 'x' }),
        ]);

        expect(() => listTarballEntries(gzipArchive(archive)))
            .toThrow(/pax record without a keyword/u);
    });

    it('rejects a pax record that is not newline terminated', () => {
        const archive = tarArchive([
            tarEntry({ name: 'PaxHeaders.0/entry', typeFlag: 'x' }, Buffer.from('9 path=xy')),
            fileEntry({ path: 'package/index.js', content: 'x' }),
        ]);

        expect(() => listTarballEntries(gzipArchive(archive)))
            .toThrow(/pax record without a terminating newline/u);
    });

    it('rejects a pax record with a non-numeric length', () => {
        const archive = tarArchive([
            tarEntry({ name: 'PaxHeaders.0/entry', typeFlag: 'x' }, Buffer.from('x path=y\n')),
            fileEntry({ path: 'package/index.js', content: 'x' }),
        ]);

        expect(() => listTarballEntries(gzipArchive(archive)))
            .toThrow(/pax record with an invalid length/u);
    });

    it('rejects a malformed pax record length', () => {
        const archive = tarArchive([
            tarEntry({ name: 'PaxHeaders.0/entry', typeFlag: 'x' }, Buffer.from('99 path=x\n')),
            fileEntry({ path: 'package/index.js', content: 'x' }),
        ]);

        expect(() => listTarballEntries(gzipArchive(archive)))
            .toThrow(/pax record/u);
    });
});

describe('inspectCandidateTarball', () => {
    it('returns the packed name and version with no failures', () => {
        const tarball = candidateTarball(
            [{ path: 'package/dist/index.js', content: 'export const x = 1;\n' }],
            { name: '@zsumz/fixture', version: '0.1.2-alpha.1' },
        );

        const inspection = inspectCandidateTarball(tarball);

        expect(inspection.failures).toEqual([]);
        expect(inspection.name).toBe('@zsumz/fixture');
        expect(inspection.version).toBe('0.1.2-alpha.1');
        expect(inspection.files.map((entry) => entry.path)).toEqual([
            'package/package.json',
            'package/dist/index.js',
        ]);
    });

    it('accepts package root directory entries', () => {
        const archive = tarArchive([
            directoryEntry('package/'),
            directoryEntry('package'),
            directoryEntry('package/dist/'),
            fileEntry({ path: 'package/package.json', content: manifest('fixture', '1.0.0') }),
        ]);

        expect(inspectCandidateTarball(gzipArchive(archive)).failures).toEqual([]);
    });

    it('rejects absolute paths', () => {
        const failures = unsafeEntryFailures(fileEntry({ path: '/etc/passwd', content: 'x' }));

        expect(failures).toContain(
            `Tarball entry ${JSON.stringify('/etc/passwd')} is an absolute path.`,
        );
    });

    it('rejects parent directory traversal', () => {
        const path = 'package/../evil.js';
        const failures = unsafeEntryFailures(fileEntry({ path, content: 'x' }));

        expect(failures).toContain(
            `Tarball entry ${JSON.stringify(path)} contains a relative path segment.`,
        );
    });

    it('rejects backslashes', () => {
        const path = 'package/dist\\evil.js';
        const failures = unsafeEntryFailures(fileEntry({ path, content: 'x' }));

        expect(failures).toContain(
            `Tarball entry ${JSON.stringify(path)} contains a backslash.`,
        );
    });

    it('rejects drive-qualified paths', () => {
        const path = 'C:/package/evil.js';
        const failures = unsafeEntryFailures(fileEntry({ path, content: 'x' }));

        expect(failures).toContain(
            `Tarball entry ${JSON.stringify(path)} is a drive-qualified path.`,
        );
    });

    it('rejects empty path segments', () => {
        const path = 'package//evil.js';
        const failures = unsafeEntryFailures(fileEntry({ path, content: 'x' }));

        expect(failures).toContain(
            `Tarball entry ${JSON.stringify(path)} contains an empty path segment.`,
        );
    });

    it('rejects entries outside the package directory', () => {
        const path = 'other/index.js';
        const failures = unsafeEntryFailures(fileEntry({ path, content: 'x' }));

        expect(failures).toContain(
            `Tarball entry ${JSON.stringify(path)} is outside package/.`,
        );
    });

    it('rejects paths containing a null byte', () => {
        const path = `package/evil${NUL}.js`;
        const archive = tarArchive([
            fileEntry({ path: 'package/package.json', content: manifest('fixture', '1.0.0') }),
            paxEntry([['path', path]]),
            fileEntry({ path: 'package/placeholder', content: 'x' }),
        ]);

        expect(inspectCandidateTarball(gzipArchive(archive)).failures).toContain(
            `Tarball entry ${JSON.stringify(path)} contains a null byte.`,
        );
    });

    it('rejects symlink, hard link and device entries', () => {
        for (const typeFlag of ['1', '2', '3', '4', '6']) {
            const failures = unsafeEntryFailures(fileEntry({ path: 'package/link', typeFlag }));

            expect(failures).toContain(
                `Tarball entry ${JSON.stringify('package/link')} `
                + 'is not a regular file or directory.',
            );
        }
    });

    it('reports malformed gzip input as a failure instead of throwing', () => {
        const inspection = inspectCandidateTarball(Buffer.from('not gzip', 'utf8'));

        expect(inspection.name).toBeNull();
        expect(inspection.version).toBeNull();
        expect(inspection.files).toEqual([]);
        expect(inspection.failures.length).toBe(1);
        expect(inspection.failures.join('')).toMatch(/not valid gzip data/u);
    });

    it('reports a missing manifest', () => {
        const tarball = candidateTarball(
            [{ path: 'package/dist/index.js', content: 'x' }],
            { omitManifest: true },
        );

        expect(inspectCandidateTarball(tarball).failures).toContain(
            'Tarball does not contain package/package.json.',
        );
    });

    it('reports a manifest that is not a regular file', () => {
        const archive = tarArchive([directoryEntry('package/package.json')]);

        expect(inspectCandidateTarball(gzipArchive(archive)).failures).toContain(
            'package/package.json must be a regular file.',
        );
    });

    it('reports invalid manifest JSON', () => {
        const archive = tarArchive([
            fileEntry({ path: 'package/package.json', content: '{ not json' }),
        ]);

        const failures = inspectCandidateTarball(gzipArchive(archive)).failures;

        expect(failures.length).toBe(1);
        expect(failures.join('')).toMatch(/^package\/package\.json is not valid JSON:/u);
    });

    it('reports a manifest that is not a JSON object', () => {
        const archive = tarArchive([
            fileEntry({ path: 'package/package.json', content: '["nope"]' }),
        ]);

        expect(inspectCandidateTarball(gzipArchive(archive)).failures).toContain(
            'package/package.json must contain a JSON object.',
        );
    });

    it('rejects an entry with an empty path', () => {
        const failures = unsafeEntryFailures(tarEntry({ name: '' }, Buffer.from('x', 'utf8')));

        expect(failures).toContain('Tarball contains an entry with an empty path.');
    });

    it('reports a manifest missing the name and version keys entirely', () => {
        const archive = tarArchive([
            fileEntry({ path: 'package/package.json', content: '{ "main": "index.js" }' }),
        ]);

        expect(inspectCandidateTarball(gzipArchive(archive)).failures).toEqual([
            'package/package.json must contain a nonempty string name.',
            'package/package.json must contain a nonempty string version.',
        ]);
    });

    it('reports a manifest without a usable name or version', () => {
        const archive = tarArchive([
            fileEntry({ path: 'package/package.json', content: '{ "name": "  ", "version": 3 }' }),
        ]);

        const inspection = inspectCandidateTarball(gzipArchive(archive));

        expect(inspection.name).toBeNull();
        expect(inspection.version).toBeNull();
        expect(inspection.failures).toEqual([
            'package/package.json must contain a nonempty string name.',
            'package/package.json must contain a nonempty string version.',
        ]);
    });
});

describe('assertCandidateTarball', () => {
    it('returns the packed manifest for a safe tarball', () => {
        const tarball = candidateTarball([], { name: 'fixture', version: '2.0.0' });

        expect(assertCandidateTarball(tarball)).toEqual({
            name: 'fixture',
            version: '2.0.0',
            files: [{
                path: 'package/package.json',
                type: 'file',
                size: Buffer.byteLength(manifest('fixture', '2.0.0')),
            }],
        });
    });

    it('throws with every failure when the tarball is unsafe', () => {
        const archive = tarArchive([
            fileEntry({ path: 'package/package.json', content: manifest('fixture', '1.0.0') }),
            fileEntry({ path: '../escape.js', content: 'x' }),
        ]);

        expect(() => assertCandidateTarball(gzipArchive(archive)))
            .toThrow(/Candidate tarball is invalid:/u);
    });
});

describe('hashTarball', () => {
    it('hashes a known vector', () => {
        expect(hashTarball(KNOWN_VECTOR)).toEqual({
            bytes: 5,
            sha256: KNOWN_SHA256,
            sha512: KNOWN_SHA512,
            integrity: KNOWN_INTEGRITY,
        });
    });

    it('hashes empty input', () => {
        expect(hashTarball(Buffer.alloc(0))).toEqual({
            bytes: 0,
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            sha512: 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce'
                + '47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
            integrity: 'sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+'
                + 'DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==',
        });
    });

    it('produces an integrity value that decodes to the sha512 digest', () => {
        const digest = hashTarball(KNOWN_VECTOR);
        const decoded = Buffer.from(digest.integrity.slice('sha512-'.length), 'base64');

        expect(decoded.toString('hex')).toBe(digest.sha512);
    });
});

describe('verifyTarballUnchanged', () => {
    it('accepts an identical buffer', () => {
        const before = hashTarball(KNOWN_VECTOR);

        const result = verifyTarballUnchanged({ before, afterBuffer: KNOWN_VECTOR });

        expect(result.unchanged).toBe(true);
        expect(result.failures).toEqual([]);
        expect(result.after).toEqual(before);
    });

    it('reports every digest that changed', () => {
        const before = hashTarball(KNOWN_VECTOR);

        const result = verifyTarballUnchanged({
            before,
            afterBuffer: Buffer.from('sallyport!', 'utf8'),
        });

        expect(result.unchanged).toBe(false);
        expect(result.failures.length).toBe(4);
        expect(result.failures.join('\n')).toMatch(/sha256 changed/u);
        expect(result.failures.join('\n')).toMatch(/byte length changed/u);
    });

    it('reports a mismatch when only the recorded digest differs', () => {
        const before = { ...hashTarball(KNOWN_VECTOR), sha256: '0'.repeat(64) };

        const result = verifyTarballUnchanged({ before, afterBuffer: KNOWN_VECTOR });

        expect(result.unchanged).toBe(false);
        expect(result.failures.length).toBe(1);
    });
});
