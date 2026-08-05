import { gunzipSync } from 'node:zlib';

import type { TarEntry, TarEntryType } from './model.ts';

const BLOCK_SIZE = 512;
const NAME_OFFSET = 0;
const NAME_LENGTH = 100;
const SIZE_OFFSET = 124;
const SIZE_LENGTH = 12;
const CHECKSUM_OFFSET = 148;
const CHECKSUM_LENGTH = 8;
const TYPE_FLAG_OFFSET = 156;
const MAGIC_OFFSET = 257;
const MAGIC_LENGTH = 6;
const PREFIX_OFFSET = 345;
const PREFIX_LENGTH = 155;
const NUL_CHARACTER = String.fromCharCode(0);
const POSIX_MAGIC = `ustar${NUL_CHARACTER}`;
const ASCII_SPACE = 0x20;
const ASCII_NEWLINE = 0x0a;
const BASE_256_MARKER = 0x80;

export interface TarRecord {
    entry: TarEntry;
    data: Buffer;
}

export function listTarballEntries(buffer: Buffer): TarEntry[] {
    return readTarballRecords(buffer).map((record) => record.entry);
}

export function readTarballRecords(buffer: Buffer): TarRecord[] {
    return readTarRecords(inflateTarball(buffer));
}

function inflateTarball(buffer: Buffer): Buffer {
    try {
        return gunzipSync(buffer);
    } catch (error) {
        throw new Error(`Tarball is not valid gzip data: ${errorMessage(error)}`, { cause: error });
    }
}

function readTarRecords(archive: Buffer): TarRecord[] {
    const records: TarRecord[] = [];
    let pending: Map<string, string> = new Map();
    let offset = 0;
    let ended = false;

    while (offset < archive.length) {
        if (offset + BLOCK_SIZE > archive.length) {
            throw new Error('Tarball is truncated: incomplete tar header block.');
        }
        const header = archive.subarray(offset, offset + BLOCK_SIZE);
        offset += BLOCK_SIZE;
        if (isZeroBlock(header)) {
            ended = true;
            break;
        }
        verifyHeaderChecksum(header);

        const typeFlag = readTypeFlag(header);
        const size = isMetadataFlag(typeFlag)
            ? readHeaderSize(header)
            : effectiveSize(header, pending);
        const padded = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
        if (offset + padded > archive.length) {
            throw new Error('Tarball is truncated: incomplete tar entry data.');
        }
        const data = archive.subarray(offset, offset + size);
        offset += padded;

        if (typeFlag === 'x' || typeFlag === 'g') {
            for (const [key, value] of parsePaxRecords(data)) {
                pending.set(key, value);
            }
            continue;
        }
        if (typeFlag === 'L') {
            pending.set('path', readCString(data));
            continue;
        }
        if (typeFlag === 'K') {
            pending.set('linkpath', readCString(data));
            continue;
        }

        const path = pending.get('path') ?? readHeaderPath(header);
        pending = new Map();
        records.push({ entry: { path, type: readEntryType(typeFlag, path), size }, data });
    }

    if (!ended) {
        throw new Error('Tarball is truncated: missing end-of-archive marker.');
    }
    return records;
}

function isMetadataFlag(typeFlag: string): boolean {
    return typeFlag === 'x' || typeFlag === 'g' || typeFlag === 'L' || typeFlag === 'K';
}

function effectiveSize(header: Buffer, pending: ReadonlyMap<string, string>): number {
    const override = pending.get('size');
    if (override === undefined) {
        return readHeaderSize(header);
    }
    if (!/^[0-9]+$/.test(override)) {
        throw new Error('Tarball contains a pax header with an invalid size record.');
    }
    const size = Number(override);
    if (!Number.isSafeInteger(size)) {
        throw new Error('Tarball contains a tar entry larger than the supported size.');
    }
    return size;
}

function isZeroBlock(header: Buffer): boolean {
    return header.every((byte) => byte === 0);
}

function verifyHeaderChecksum(header: Buffer): void {
    const stored = readOctal(header.subarray(CHECKSUM_OFFSET, CHECKSUM_OFFSET + CHECKSUM_LENGTH));
    if (stored === null) {
        throw new Error('Tarball contains a tar header with an unreadable checksum.');
    }
    let unsigned = 0;
    let signed = 0;
    for (let index = 0; index < BLOCK_SIZE; index += 1) {
        const inChecksumField = index >= CHECKSUM_OFFSET
            && index < CHECKSUM_OFFSET + CHECKSUM_LENGTH;
        const byte = inChecksumField ? ASCII_SPACE : header.readUInt8(index);
        unsigned += byte;
        signed += byte > 127 ? byte - 256 : byte;
    }
    if (stored !== unsigned && stored !== signed) {
        throw new Error('Tarball contains a tar header with an invalid checksum.');
    }
}

function readTypeFlag(header: Buffer): string {
    const byte = header.readUInt8(TYPE_FLAG_OFFSET);
    return byte === 0 ? '0' : String.fromCharCode(byte);
}

function readEntryType(typeFlag: string, path: string): TarEntryType {
    if (typeFlag === '5') {
        return 'directory';
    }
    if (typeFlag === '0' || typeFlag === '7') {
        return path.endsWith('/') ? 'directory' : 'file';
    }
    return 'other';
}

function readHeaderSize(header: Buffer): number {
    const field = header.subarray(SIZE_OFFSET, SIZE_OFFSET + SIZE_LENGTH);
    if ((field.readUInt8(0) & BASE_256_MARKER) !== 0) {
        return readBase256(field);
    }
    const size = readOctal(field);
    if (size === null) {
        throw new Error('Tarball contains a tar header with an invalid size field.');
    }
    return size;
}

function readBase256(field: Buffer): number {
    if (field.readUInt8(0) !== BASE_256_MARKER) {
        throw new Error('Tarball contains a negative or unsupported base-256 tar size.');
    }
    let value = 0;
    for (let index = 1; index < field.length; index += 1) {
        value = value * 256 + field.readUInt8(index);
    }
    if (!Number.isSafeInteger(value)) {
        throw new Error('Tarball contains a tar entry larger than the supported size.');
    }
    return value;
}

function readOctal(field: Buffer): number | null {
    const text = field.toString('latin1').replaceAll(NUL_CHARACTER, '').trim();
    if (text === '' || !/^[0-7]+$/.test(text)) {
        return null;
    }
    const value = Number.parseInt(text, 8);
    return Number.isSafeInteger(value) ? value : null;
}

function readHeaderPath(header: Buffer): string {
    const name = readField(header, NAME_OFFSET, NAME_LENGTH);
    const magic = header.subarray(MAGIC_OFFSET, MAGIC_OFFSET + MAGIC_LENGTH).toString('latin1');
    if (magic !== POSIX_MAGIC) {
        return name;
    }
    const prefix = readField(header, PREFIX_OFFSET, PREFIX_LENGTH);
    return prefix === '' ? name : `${prefix}/${name}`;
}

function readField(header: Buffer, offset: number, length: number): string {
    return readCString(header.subarray(offset, offset + length));
}

function readCString(field: Buffer): string {
    const end = field.indexOf(0);
    const slice = end === -1 ? field : field.subarray(0, end);
    return slice.toString('utf8');
}

function parsePaxRecords(data: Buffer): Array<[string, string]> {
    const records: Array<[string, string]> = [];
    let offset = 0;
    while (offset < data.length) {
        const space = data.indexOf(ASCII_SPACE, offset);
        if (space === -1) {
            throw new Error('Tarball contains a malformed pax extended header.');
        }
        const digits = data.subarray(offset, space).toString('latin1');
        if (!/^[0-9]+$/.test(digits)) {
            throw new Error('Tarball contains a pax record with an invalid length.');
        }
        const length = Number(digits);
        if (length <= space - offset + 1 || offset + length > data.length) {
            throw new Error('Tarball contains a pax record with an invalid length.');
        }
        if (data.readUInt8(offset + length - 1) !== ASCII_NEWLINE) {
            throw new Error('Tarball contains a pax record without a terminating newline.');
        }
        const text = data.subarray(space + 1, offset + length - 1).toString('utf8');
        const separator = text.indexOf('=');
        if (separator <= 0) {
            throw new Error('Tarball contains a pax record without a keyword.');
        }
        records.push([text.slice(0, separator), text.slice(separator + 1)]);
        offset += length;
    }
    return records;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
