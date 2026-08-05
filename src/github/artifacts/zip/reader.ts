import type { ZipEntry } from '../model.ts';
import { readEntryData } from './entry.ts';
import {
    CENTRAL_HEADER_SIZE,
    CENTRAL_SIGNATURE,
    MAX_COMMENT,
    ZIP64_MARKER,
} from './model.ts';
import {
    decodeEntryName,
    findEndOfCentralDirectory,
    isSafeEntryName,
    requireRange,
    zipError,
} from './support.ts';

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
