import type { Buffer } from 'node:buffer';

export interface DerValue {
    tag: number;
    content: Buffer;
}

export function readDerDocument(bytes: Buffer): DerValue {
    const value = readDerValue(bytes, 0);
    if (value.end !== bytes.length) {
        throw new Error('DER document carries trailing bytes.');
    }
    return { tag: value.tag, content: value.content };
}

export function readDerChildren(value: DerValue): DerValue[] {
    const children: DerValue[] = [];
    let offset = 0;
    while (offset < value.content.length) {
        const child = readDerValue(value.content, offset);
        children.push({ tag: child.tag, content: child.content });
        offset = child.end;
    }
    return children;
}

export function requireDerTag(value: DerValue, tag: number, label: string): DerValue {
    if (value.tag !== tag) {
        throw new Error(`${label} has DER tag 0x${value.tag.toString(16)}, expected 0x${tag.toString(16)}.`);
    }
    return value;
}

export function decodeDerOid(value: DerValue): string {
    requireDerTag(value, 0x06, 'certificate extension OID');
    const identifiers = decodeIdentifiers(value.content);
    if (identifiers.length === 0) {
        throw new Error('certificate extension OID is empty.');
    }
    const first = identifiers[0] ?? 0;
    const firstArc = first < 40 ? 0 : first < 80 ? 1 : 2;
    const secondArc = first - firstArc * 40;
    return [firstArc, secondArc, ...identifiers.slice(1)].join('.');
}

export function decodeDerUtf8(value: DerValue): string {
    requireDerTag(value, 0x0c, 'Fulcio extension');
    return new TextDecoder('utf-8', { fatal: true }).decode(value.content);
}

function readDerValue(
    bytes: Buffer,
    offset: number,
): { tag: number; content: Buffer; end: number } {
    const tag = bytes[offset];
    const firstLength = bytes[offset + 1];
    if (tag === undefined || firstLength === undefined) {
        throw new Error('DER value is truncated.');
    }
    if ((tag & 0x1f) === 0x1f) {
        throw new Error('high-tag-number DER values are unsupported.');
    }
    let length = firstLength;
    let header = 2;
    if ((firstLength & 0x80) !== 0) {
        const count = firstLength & 0x7f;
        if (count === 0 || count > 4 || offset + 2 + count > bytes.length) {
            throw new Error('DER length is invalid.');
        }
        if (bytes[offset + 2] === 0) {
            throw new Error('DER length is not minimally encoded.');
        }
        length = 0;
        for (let index = 0; index < count; index += 1) {
            length = length * 256 + (bytes[offset + 2 + index] ?? 0);
        }
        if (length < 128) {
            throw new Error('DER length is not minimally encoded.');
        }
        header += count;
    }
    const start = offset + header;
    const end = start + length;
    if (!Number.isSafeInteger(end) || end > bytes.length) {
        throw new Error('DER value exceeds its container.');
    }
    return { tag, content: bytes.subarray(start, end), end };
}

function decodeIdentifiers(bytes: Buffer): number[] {
    const identifiers: number[] = [];
    let value = 0;
    let continued = false;
    for (const byte of bytes) {
        value = value * 128 + (byte & 0x7f);
        if (!Number.isSafeInteger(value)) {
            throw new Error('certificate extension OID is too large.');
        }
        continued = (byte & 0x80) !== 0;
        if (!continued) {
            identifiers.push(value);
            value = 0;
        }
    }
    if (continued) {
        throw new Error('certificate extension OID is truncated.');
    }
    return identifiers;
}
