import { MAX_COMMENT } from './model.ts';

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;

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

export function findEndOfCentralDirectory(view: DataView, total: number): number {
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

export function decodeEntryName(bytes: Uint8Array): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw zipError('an entry name is not valid UTF-8');
    }
}

export function requireRange(start: number, length: number, total: number, what: string): void {
    if (start < 0 || length < 0 || start + length > total) {
        throw zipError(`${what} is out of range`);
    }
}

export function zipError(reason: string): Error {
    return new Error(`Candidate artifact is not a readable zip archive: ${reason}.`);
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
