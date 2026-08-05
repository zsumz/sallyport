import { gunzipSync } from 'node:zlib';

import type { TarEntry } from '../model.ts';
import {
    BLOCK_SIZE,
    readCString,
    readEntryType,
    readHeaderPath,
    readHeaderSize,
    readTypeFlag,
    verifyHeaderChecksum,
} from './header.ts';
import { parsePaxRecords } from './pax.ts';

export interface TarRecord {
    entry: TarEntry;
    data: Buffer;
}

export function listTarballEntries(buffer: Buffer): TarEntry[] {
    return readTarballRecords(buffer).map((record) => record.entry);
}

export function readTarballRecords(buffer: Buffer): TarRecord[] {
    let archive: Buffer;
    try {
        archive = gunzipSync(buffer);
    } catch (error) {
        throw new Error(`Tarball is not valid gzip data: ${errorMessage(error)}`, { cause: error });
    }
    return readTarRecords(archive);
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
        if (header.every((byte) => byte === 0)) {
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
        if (typeFlag === 'L' || typeFlag === 'K') {
            pending.set(typeFlag === 'L' ? 'path' : 'linkpath', readCString(data));
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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
