import { inflateRawSync } from 'node:zlib';

import type { ZipEntry } from './model.ts';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const MAX_COMMENT = 0xffff;
const ZIP64_MARKER = 0xffffffff;
const STORED = 0;
const DEFLATED = 8;

interface EntryLocation {
    localOffset: number;
    method: number;
    crc: number;
    compressedSize: number;
    uncompressedSize: number;
    name: string;
}

export function isSafeEntryName(name: string): boolean {
    if (name.length === 0 || name.length > 255) {
        return false;
    }
    if (name.includes('\\') || name.startsWith('/')) {
        return false;
    }
    if (hasControlCharacter(name) || /^[a-z]:/i.test(name)) {
        return false;
    }
    return name
        .split('/')
        .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

// Minimal ZIP reader: end-of-central-directory scan, central directory walk,
// local header data offsets, STORE and DEFLATE only. No dependencies.
export function readZipEntries(zip: Uint8Array): ZipEntry[] {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const total = zip.byteLength;
    const eocd = findEndOfCentralDirectory(view, total);
    const count = view.getUint16(eocd + 10, true);
    const directorySize = view.getUint32(eocd + 12, true);
    const directoryOffset = view.getUint32(eocd + 16, true);
    if (count === MAX_COMMENT || directorySize === ZIP64_MARKER || directoryOffset === ZIP64_MARKER) {
        throw zipError('zip64 archives are not supported');
    }
    requireRange(directoryOffset, directorySize, total, 'the central directory');
    const entries: ZipEntry[] = [];
    let cursor = directoryOffset;
    for (let index = 0; index < count; index += 1) {
        requireRange(cursor, CENTRAL_HEADER_SIZE, total, 'a central directory header');
        if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
            throw zipError('a central directory header is missing its signature');
        }
        const flags = view.getUint16(cursor + 8, true);
        const method = view.getUint16(cursor + 10, true);
        const crc = view.getUint32(cursor + 16, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const uncompressedSize = view.getUint32(cursor + 24, true);
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        const localOffset = view.getUint32(cursor + 42, true);
        if ((flags & 0x0001) !== 0) {
            throw zipError('encrypted entries are not supported');
        }
        if (compressedSize === ZIP64_MARKER || uncompressedSize === ZIP64_MARKER || localOffset === ZIP64_MARKER) {
            throw zipError('zip64 archives are not supported');
        }
        requireRange(cursor + CENTRAL_HEADER_SIZE, nameLength, total, 'an entry name');
        const name = decodeEntryName(
            zip.subarray(cursor + CENTRAL_HEADER_SIZE, cursor + CENTRAL_HEADER_SIZE + nameLength),
        );
        if (!isSafeEntryName(name)) {
            throw new Error(`Candidate artifact contains an unsafe entry name: ${name}.`);
        }
        entries.push({
            name,
            data: readEntryData(zip, view, {
                localOffset,
                method,
                crc,
                compressedSize,
                uncompressedSize,
                name,
            }),
        });
        cursor += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
    }
    return entries;
}

function readEntryData(zip: Uint8Array, view: DataView, entry: EntryLocation): Uint8Array {
    const total = zip.byteLength;
    requireRange(entry.localOffset, LOCAL_HEADER_SIZE, total, 'a local file header');
    if (view.getUint32(entry.localOffset, true) !== LOCAL_SIGNATURE) {
        throw zipError('a local file header is missing its signature');
    }
    const nameLength = view.getUint16(entry.localOffset + 26, true);
    const extraLength = view.getUint16(entry.localOffset + 28, true);
    const start = entry.localOffset + LOCAL_HEADER_SIZE + nameLength + extraLength;
    requireRange(start, entry.compressedSize, total, `the contents of ${entry.name}`);
    const raw = zip.subarray(start, start + entry.compressedSize);
    const data = inflateEntry(raw, entry);
    if (data.byteLength !== entry.uncompressedSize) {
        throw new Error(
            `Candidate artifact entry ${entry.name} is ${String(data.byteLength)} bytes, expected ${String(entry.uncompressedSize)}.`,
        );
    }
    if (crc32(data) !== entry.crc) {
        throw new Error(`Candidate artifact entry ${entry.name} failed its CRC check.`);
    }
    return data;
}

// Entry data is always copied into a plain Uint8Array so callers never hold a
// view into the archive buffer.
function inflateEntry(raw: Uint8Array, entry: EntryLocation): Uint8Array {
    if (entry.method === STORED) {
        return new Uint8Array(raw);
    }
    if (entry.method !== DEFLATED) {
        throw new Error(
            `Candidate artifact entry ${entry.name} uses unsupported compression method ${String(entry.method)}.`,
        );
    }
    try {
        return new Uint8Array(inflateRawSync(raw));
    } catch {
        throw new Error(`Candidate artifact entry ${entry.name} could not be inflated.`);
    }
}

function findEndOfCentralDirectory(view: DataView, total: number): number {
    if (total < EOCD_SIZE) {
        throw zipError('the archive is too small');
    }
    const limit = Math.max(0, total - EOCD_SIZE - MAX_COMMENT);
    for (let offset = total - EOCD_SIZE; offset >= limit; offset -= 1) {
        if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
            return offset;
        }
    }
    throw zipError('the end of central directory record was not found');
}

function decodeEntryName(bytes: Uint8Array): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw zipError('an entry name is not valid UTF-8');
    }
}

function requireRange(start: number, length: number, total: number, what: string): void {
    if (start < 0 || length < 0 || start + length > total) {
        throw zipError(`${what} is out of range`);
    }
}

function hasControlCharacter(name: string): boolean {
    for (const character of name) {
        const code = character.codePointAt(0) ?? 0;
        if (code < 0x20 || code === 0x7f) {
            return true;
        }
    }
    return false;
}

function zipError(reason: string): Error {
    return new Error(`Candidate artifact is not a readable zip archive: ${reason}.`);
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) === 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
        }
        table[index] = value;
    }
    return table;
}

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ crc >>> 8;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
