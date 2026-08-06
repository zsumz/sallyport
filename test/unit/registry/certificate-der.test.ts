import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';

import {
    decodeDerOid,
    decodeDerUtf8,
    readDerChildren,
    readDerDocument,
    requireDerTag,
} from '../../../src/registry/provenance/certificate/der.ts';

describe('certificate DER decoder', () => {
    it('reads a complete document and its children', () => {
        const document = readDerDocument(Buffer.from([0x30, 0x02, 0x05, 0x00]));

        expect(document.tag).toBe(0x30);
        expect(readDerChildren(document)).toStrictEqual([
            { tag: 0x05, content: Buffer.alloc(0) },
        ]);
    });

    it.each([
        [Buffer.alloc(0), 'DER value is truncated.'],
        [Buffer.from([0x05, 0x00, 0x00]), 'DER document carries trailing bytes.'],
        [Buffer.from([0x1f, 0x00]), 'high-tag-number DER values are unsupported.'],
        [Buffer.from([0x04, 0x80]), 'DER length is invalid.'],
        [Buffer.from([0x04, 0x85, 0x01, 0x02, 0x03, 0x04, 0x05]), 'DER length is invalid.'],
        [Buffer.from([0x04, 0x82, 0x01]), 'DER length is invalid.'],
        [Buffer.from([0x04, 0x81, 0x00]), 'DER length is not minimally encoded.'],
        [Buffer.from([0x04, 0x81, 0x7f]), 'DER length is not minimally encoded.'],
        [Buffer.from([0x04, 0x02, 0x00]), 'DER value exceeds its container.'],
    ])('rejects malformed DER %#', (bytes, message) => {
        expect(() => readDerDocument(bytes)).toThrow(message);
    });

    it('rejects an unexpected tag', () => {
        expect(() => requireDerTag(
            readDerDocument(Buffer.from([0x05, 0x00])),
            0x30,
            'certificate',
        )).toThrow('certificate has DER tag 0x5, expected 0x30.');
    });

    it('decodes an OID and UTF-8 extension', () => {
        expect(decodeDerOid(readDerDocument(Buffer.from([
            0x06, 0x03, 0x2a, 0x86, 0x48,
        ])))).toBe('1.2.840');
        expect(decodeDerUtf8(readDerDocument(Buffer.from([
            0x0c, 0x03, 0xe2, 0x98, 0x83,
        ])))).toBe('☃');
    });

    it.each([
        [Buffer.from([0x06, 0x00]), 'certificate extension OID is empty.'],
        [Buffer.from([0x06, 0x01, 0x80]), 'certificate extension OID is truncated.'],
        [
            Buffer.from([0x06, 0x09, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]),
            'certificate extension OID is too large.',
        ],
    ])('rejects an invalid OID %#', (bytes, message) => {
        expect(() => decodeDerOid(readDerDocument(bytes))).toThrow(message);
    });

    it('rejects invalid UTF-8 extension bytes', () => {
        expect(() => decodeDerUtf8(readDerDocument(Buffer.from([0x0c, 0x01, 0xff]))))
            .toThrow();
    });
});
