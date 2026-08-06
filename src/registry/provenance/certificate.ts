import { Buffer } from 'node:buffer';

import { readArrayProperty, readProperty, readStringProperty } from '../download.ts';
import { readCertificateClaims } from './certificate/x509.ts';
import { UNRECOGNIZED, type ExpectedProvenance } from './model.ts';

const OID = '1.3.6.1.4.1.57264.1.';
const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';

export function certificateFailures(bundle: unknown, expected: ExpectedProvenance): string[] {
    const encoded = signingCertificate(bundle);
    if (encoded === null) {
        return [`${UNRECOGNIZED}: the provenance bundle carries no unambiguous signing certificate.`];
    }
    let claims;
    try {
        claims = readCertificateClaims(decodeBase64(encoded));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [`${UNRECOGNIZED}: the provenance signing certificate is malformed: ${message}`];
    }
    const tagRef = normalizeTagRef(expected.tagRef);
    const repositoryUrl = `https://github.com/${expected.repository}`;
    const builderUrl = `https://github.com/${expected.builderWorkflow}@${expected.builderSha}`;
    const runUrl = `${repositoryUrl}/actions/runs/${String(expected.runId)}`
        + `/attempts/${String(expected.runAttempt)}`;
    const expectedClaims: ReadonlyArray<readonly [string, string, string]> = [
        ['OIDC issuer', `${OID}8`, GITHUB_ISSUER],
        ['build signer URI', `${OID}9`, builderUrl],
        ['build signer digest', `${OID}10`, expected.builderSha],
        ['runner environment', `${OID}11`, 'github-hosted'],
        ['source repository URI', `${OID}12`, repositoryUrl],
        ['source repository digest', `${OID}13`, expected.sourceCommit],
        ['source repository ref', `${OID}14`, tagRef],
        ['source repository ID', `${OID}15`, String(expected.repositoryId)],
        [
            'build config URI',
            `${OID}18`,
            `${repositoryUrl}/${expected.workflowPath}@${tagRef}`,
        ],
        ['build config digest', `${OID}19`, expected.sourceCommit],
        ['build trigger', `${OID}20`, 'push'],
        ['run invocation URI', `${OID}21`, runUrl],
    ];
    const failures: string[] = [];
    if (claims.san !== builderUrl) {
        failures.push(`Provenance certificate SAN ${claims.san} does not match ${builderUrl}.`);
    }
    for (const [label, oid, wanted] of expectedClaims) {
        const actual = claims.extensions.get(oid);
        if (actual === undefined) {
            failures.push(`${UNRECOGNIZED}: the provenance certificate has no ${label}.`);
        } else if (actual !== wanted) {
            failures.push(`Provenance certificate ${label} ${actual} does not match ${wanted}.`);
        }
    }
    return failures;
}

function signingCertificate(bundle: unknown): string | null {
    const material = readProperty(bundle, 'verificationMaterial');
    const direct = readStringProperty(readProperty(material, 'certificate'), 'rawBytes');
    const chain = readArrayProperty(readProperty(material, 'x509CertificateChain'), 'certificates');
    const chained = chain?.length === 1
        ? readStringProperty(chain[0], 'rawBytes')
        : null;
    const candidates = [direct, chained].filter((value): value is string => value !== null);
    return candidates.length === 1 ? candidates.at(0) ?? null : null;
}

function decodeBase64(value: string): Buffer {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
        throw new Error('certificate rawBytes is not canonical base64.');
    }
    return Buffer.from(value, 'base64');
}

function normalizeTagRef(value: string): string {
    return value.startsWith('refs/') ? value : `refs/tags/${value}`;
}
