import { gzipSync } from 'node:zlib';

const BLOCK_SIZE = 512;
const CHECKSUM_OFFSET = 148;
const CHECKSUM_LENGTH = 8;

export const NUL = String.fromCharCode(0);
export const USTAR_MAGIC = `ustar${NUL}00`;
export const GNU_MAGIC = 'ustar  ';

export interface TarHeaderOptions {
    name: string;
    size?: number;
    typeFlag?: string;
    prefix?: string;
    magic?: string;
    base256Size?: boolean;
    corruptChecksum?: boolean;
    rawSizeField?: Buffer;
}

export interface FixtureFile {
    path: string;
    content?: string;
    typeFlag?: string;
}

export function tarHeader(options: TarHeaderOptions): Buffer {
    const header = Buffer.alloc(BLOCK_SIZE);
    const size = options.size ?? 0;
    header.write(options.name, 0, 100, 'utf8');
    writeOctal(header, 0o644, 100, 8);
    writeOctal(header, 0, 108, 8);
    writeOctal(header, 0, 116, 8);
    if (options.base256Size === true) {
        writeBase256(header, size, 124, 12);
    } else {
        writeOctal(header, size, 124, 12);
    }
    if (options.rawSizeField !== undefined) {
        options.rawSizeField.copy(header, 124, 0, Math.min(options.rawSizeField.length, 12));
    }
    writeOctal(header, 0, 136, 12);
    header.write(options.typeFlag ?? '0', 156, 1, 'latin1');
    header.write(options.magic ?? USTAR_MAGIC, 257, 8, 'latin1');
    if (options.prefix !== undefined) {
        header.write(options.prefix, 345, 155, 'utf8');
    }
    writeChecksum(header, options.corruptChecksum === true);
    return header;
}

export function tarEntry(options: TarHeaderOptions, content: Buffer = Buffer.alloc(0)): Buffer {
    const header = tarHeader({ ...options, size: options.size ?? content.length });
    return Buffer.concat([header, content, padding(content.length)]);
}

export function fileEntry(file: FixtureFile): Buffer {
    const content = Buffer.from(file.content ?? '', 'utf8');
    const options: TarHeaderOptions = { name: file.path, typeFlag: file.typeFlag ?? '0' };
    return tarEntry(options, content);
}

export function directoryEntry(name: string): Buffer {
    return tarEntry({ name, typeFlag: '5' });
}

export function paxEntry(
    records: ReadonlyArray<[string, string]>,
    typeFlag = 'x',
): Buffer {
    const data = Buffer.concat(records.map(([key, value]) => paxRecord(key, value)));
    return tarEntry({ name: 'PaxHeaders.0/entry', typeFlag }, data);
}

export function longNameEntry(name: string): Buffer {
    return tarEntry({ name: './@LongLink', typeFlag: 'L' }, Buffer.from(`${name}${NUL}`, 'utf8'));
}

export function longLinkEntry(target: string): Buffer {
    return tarEntry({ name: './@LongLink', typeFlag: 'K' }, Buffer.from(`${target}${NUL}`, 'utf8'));
}

export function tarArchive(entries: readonly Buffer[], endBlocks = 2): Buffer {
    return Buffer.concat([...entries, Buffer.alloc(BLOCK_SIZE * endBlocks)]);
}

export function gzipArchive(archive: Buffer): Buffer {
    return gzipSync(archive);
}

export function manifest(name: string, version: string): string {
    return `${JSON.stringify({ name, version, main: 'index.js' }, null, 2)}\n`;
}

// A minimal well-formed candidate: package/package.json plus whatever else the test needs.
export function candidateTarball(
    files: readonly FixtureFile[] = [],
    options: { name?: string; version?: string; omitManifest?: boolean } = {},
): Buffer {
    const entries = files.map(fileEntry);
    if (options.omitManifest !== true) {
        entries.unshift(fileEntry({
            path: 'package/package.json',
            content: manifest(options.name ?? 'quoin-fixture', options.version ?? '1.2.3'),
        }));
    }
    return gzipArchive(tarArchive(entries));
}

function paxRecord(key: string, value: string): Buffer {
    const body = Buffer.byteLength(` ${key}=${value}\n`, 'utf8');
    let length = body + 1;
    while (body + String(length).length !== length) {
        length = body + String(length).length;
    }
    return Buffer.from(`${String(length)} ${key}=${value}\n`, 'utf8');
}

function padding(size: number): Buffer {
    const remainder = size % BLOCK_SIZE;
    return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK_SIZE - remainder);
}

function writeOctal(header: Buffer, value: number, offset: number, length: number): void {
    header.write(value.toString(8).padStart(length - 1, '0'), offset, length - 1, 'latin1');
}

function writeBase256(header: Buffer, value: number, offset: number, length: number): void {
    header.writeUInt8(0x80, offset);
    let remaining = value;
    for (let index = offset + length - 1; index > offset; index -= 1) {
        header.writeUInt8(remaining % 256, index);
        remaining = Math.floor(remaining / 256);
    }
}

function writeChecksum(header: Buffer, corrupt: boolean): void {
    let sum = 0;
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
        const inChecksumField = index >= CHECKSUM_OFFSET
            && index < CHECKSUM_OFFSET + CHECKSUM_LENGTH;
        sum += inChecksumField ? 0x20 : header.readUInt8(index);
    }
    const value = corrupt ? sum + 1 : sum;
    header.write(value.toString(8).padStart(6, '0'), CHECKSUM_OFFSET, 6, 'latin1');
    header.write(' ', CHECKSUM_OFFSET + 7, 1, 'latin1');
}
