import { inflateRawSync } from 'node:zlib';

import type { EntryLocation } from './model.ts';
import { requireRange, zipError } from './support.ts';

const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;
const STORED = 0;
const DEFLATED = 8;

export function readEntryData(
    zip: Uint8Array,
    view: DataView,
    entry: EntryLocation,
): Uint8Array {
    const total = zip.byteLength;
    requireRange(entry.localOffset, LOCAL_HEADER_SIZE, total, 'a local file header');
    if (view.getUint32(entry.localOffset, true) !== LOCAL_SIGNATURE) {
        throw zipError('a local file header is missing its signature');
    }
    const nameLength = view.getUint16(entry.localOffset + 26, true);
    const extraLength = view.getUint16(entry.localOffset + 28, true);
    const start = entry.localOffset + LOCAL_HEADER_SIZE + nameLength + extraLength;
    requireRange(start, entry.compressedSize, total, `the contents of ${entry.name}`);
    const data = inflateEntry(zip.subarray(start, start + entry.compressedSize), entry);
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

// Entry data is always copied so callers never hold a view into the archive.
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
