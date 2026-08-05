import type { TarEntryType } from '../model.ts';

export const BLOCK_SIZE = 512;

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
const BASE_256_MARKER = 0x80;

export function verifyHeaderChecksum(header: Buffer): void {
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

export function readTypeFlag(header: Buffer): string {
    const byte = header.readUInt8(TYPE_FLAG_OFFSET);
    return byte === 0 ? '0' : String.fromCharCode(byte);
}

export function readEntryType(typeFlag: string, path: string): TarEntryType {
    if (typeFlag === '5') {
        return 'directory';
    }
    if (typeFlag === '0' || typeFlag === '7') {
        return path.endsWith('/') ? 'directory' : 'file';
    }
    return 'other';
}

export function readHeaderSize(header: Buffer): number {
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

export function readHeaderPath(header: Buffer): string {
    const name = readField(header, NAME_OFFSET, NAME_LENGTH);
    const magic = header.subarray(MAGIC_OFFSET, MAGIC_OFFSET + MAGIC_LENGTH).toString('latin1');
    if (magic !== POSIX_MAGIC) {
        return name;
    }
    const prefix = readField(header, PREFIX_OFFSET, PREFIX_LENGTH);
    return prefix === '' ? name : `${prefix}/${name}`;
}

export function readCString(field: Buffer): string {
    const end = field.indexOf(0);
    const slice = end === -1 ? field : field.subarray(0, end);
    return slice.toString('utf8');
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

function readField(header: Buffer, offset: number, length: number): string {
    return readCString(header.subarray(offset, offset + length));
}
