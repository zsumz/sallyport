import type { Buffer } from 'node:buffer';

import {
    decodeDerOid,
    decodeDerUtf8,
    readDerChildren,
    readDerDocument,
    requireDerTag,
    type DerValue,
} from './der.ts';

const EXTENSIONS_TAG = 0xa3;
const SAN_OID = '2.5.29.17';

export interface CertificateClaims {
    san: string;
    extensions: ReadonlyMap<string, string>;
}

export function readCertificateClaims(bytes: Buffer): CertificateClaims {
    const certificate = requireDerTag(readDerDocument(bytes), 0x30, 'certificate');
    const certificateFields = readDerChildren(certificate);
    if (certificateFields.length !== 3) {
        throw new Error('certificate must contain its body, algorithm, and signature.');
    }
    const body = requireDerTag(required(certificateFields, 0), 0x30, 'certificate body');
    const extensionContainers = readDerChildren(body)
        .filter((field) => field.tag === EXTENSIONS_TAG);
    if (extensionContainers.length !== 1) {
        throw new Error('certificate must contain exactly one extensions field.');
    }
    const wrapped = readDerChildren(required(extensionContainers, 0));
    if (wrapped.length !== 1) {
        throw new Error('certificate extensions field is malformed.');
    }
    const extensions = parseExtensions(
        requireDerTag(required(wrapped, 0), 0x30, 'certificate extensions'),
    );
    const sanBytes = extensions.get(SAN_OID);
    if (sanBytes === undefined) {
        throw new Error('certificate has no subject alternative name.');
    }
    extensions.delete(SAN_OID);
    return { san: parseSan(sanBytes), extensions: decodeExtensions(extensions) };
}

function parseExtensions(sequence: DerValue): Map<string, Buffer> {
    const extensions: Map<string, Buffer> = new Map();
    for (const entry of readDerChildren(sequence)) {
        const fields = readDerChildren(requireDerTag(entry, 0x30, 'certificate extension'));
        if (fields.length < 2 || fields.length > 3) {
            throw new Error('certificate extension is malformed.');
        }
        const oid = decodeDerOid(required(fields, 0));
        const value = required(fields, fields.length - 1);
        requireDerTag(value, 0x04, `certificate extension ${oid}`);
        if (extensions.has(oid)) {
            throw new Error(`certificate repeats extension ${oid}.`);
        }
        extensions.set(oid, value.content);
    }
    return extensions;
}

function parseSan(bytes: Buffer): string {
    const names = readDerChildren(requireDerTag(readDerDocument(bytes), 0x30, 'certificate SAN'));
    if (names.length !== 1 || names[0]?.tag !== 0x86) {
        throw new Error('certificate SAN must contain exactly one URI identity.');
    }
    return new TextDecoder('ascii', { fatal: true }).decode(names[0].content);
}

function decodeExtensions(extensions: ReadonlyMap<string, Buffer>): Map<string, string> {
    const claims: Map<string, string> = new Map();
    for (const [oid, bytes] of extensions) {
        const match = /^1\.3\.6\.1\.4\.1\.57264\.1\.(\d+)$/u.exec(oid);
        const extension = match === null ? Number.NaN : Number(match[1]);
        if (!Number.isInteger(extension) || extension < 8 || extension > 24) {
            continue;
        }
        claims.set(oid, decodeDerUtf8(readDerDocument(bytes)));
    }
    return claims;
}

function required<T>(values: readonly T[], index: number): T {
    const value = values.at(index);
    if (value === undefined) {
        throw new Error('certificate structure is truncated.');
    }
    return value;
}
