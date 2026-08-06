import { Buffer } from 'node:buffer';

import type { ExpectedProvenance } from '../../../src/registry/provenance.ts';

const OID = '1.3.6.1.4.1.57264.1.';

export function certificateRawBytes(
    expected: ExpectedProvenance,
    overrides: Readonly<Record<string, string>> = {},
): string {
    const tagRef = expected.tagRef.startsWith('refs/')
        ? expected.tagRef
        : `refs/tags/${expected.tagRef}`;
    const repositoryUrl = `https://github.com/${expected.repository}`;
    const builderUrl = `https://github.com/${expected.builderWorkflow}@${expected.builderSha}`;
    const claims: Record<string, string> = {
        [`${OID}8`]: 'https://token.actions.githubusercontent.com',
        [`${OID}9`]: builderUrl,
        [`${OID}10`]: expected.builderSha,
        [`${OID}11`]: 'github-hosted',
        [`${OID}12`]: repositoryUrl,
        [`${OID}13`]: expected.sourceCommit,
        [`${OID}14`]: tagRef,
        [`${OID}15`]: String(expected.repositoryId),
        [`${OID}18`]: `${repositoryUrl}/${expected.workflowPath}@${tagRef}`,
        [`${OID}19`]: expected.sourceCommit,
        [`${OID}20`]: 'push',
        [`${OID}21`]: `${repositoryUrl}/actions/runs/${String(expected.runId)}`
            + `/attempts/${String(expected.runAttempt)}`,
        ...overrides,
    };
    const san = claims.san ?? builderUrl;
    delete claims.san;
    const extensions = [
        extension('2.5.29.17', sequence(value(0x86, Buffer.from(san, 'ascii')))),
        // Fulcio still emits deprecated raw strings beside the v2 extensions.
        extension(`${OID}1`, Buffer.from('https://token.actions.githubusercontent.com', 'ascii')),
        extension(`${OID}2`, Buffer.from('push', 'ascii')),
        ...Object.entries(claims).map(([oid, claim]) =>
            extension(oid, value(0x0c, Buffer.from(claim, 'utf8'))),
        ),
    ];
    const body = sequence(value(0xa3, sequence(...extensions)));
    const certificate = sequence(body, sequence(), value(0x03, Buffer.from([0])));
    return certificate.toString('base64');
}

function extension(oid: string, bytes: Buffer): Buffer {
    return sequence(value(0x06, encodeOid(oid)), value(0x04, bytes));
}

function sequence(...values: Buffer[]): Buffer {
    return value(0x30, Buffer.concat(values));
}

function value(tag: number, content: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

function encodeLength(length: number): Buffer {
    if (length < 128) return Buffer.from([length]);
    const bytes: number[] = [];
    let remaining = length;
    while (remaining > 0) {
        bytes.unshift(remaining & 0xff);
        remaining = Math.floor(remaining / 256);
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function encodeOid(oid: string): Buffer {
    const arcs = oid.split('.').map(Number);
    const first = arcs.shift() ?? 0;
    const second = arcs.shift() ?? 0;
    return Buffer.from([first * 40 + second, ...arcs.flatMap(base128)]);
}

function base128(value: number): number[] {
    const bytes = [value & 0x7f];
    let remaining = Math.floor(value / 128);
    while (remaining > 0) {
        bytes.unshift(remaining & 0x7f | 0x80);
        remaining = Math.floor(remaining / 128);
    }
    return bytes;
}
