import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { CommandResult } from '../../../src/report/exec.ts';
import type { FetchJson } from '../../../src/registry/download.ts';
import {
    runAuditSignatures,
    verifyAuditSignatures,
    verifyProvenanceIdentity,
    verifyRegistryProvenance,
    type CommandRunner,
    type ExpectedProvenance,
} from '../../../src/registry/provenance.ts';

const TARBALL_SHA512 = 'e'.repeat(128);

function expected(): ExpectedProvenance {
    return {
        packageName: 'demo',
        packageVersion: '1.2.3',
        repository: 'zsumz/demo',
        workflowPath: '.github/workflows/quoin.yml',
        tagRef: 'refs/tags/v1.2.3',
        tarballSha512: TARBALL_SHA512,
        runId: 42,
    };
}

function statementV1(): Record<string, unknown> {
    return {
        _type: 'https://in-toto.io/Statement/v1',
        predicateType: 'https://slsa.dev/provenance/v1',
        subject: [
            { name: 'pkg:npm/demo@1.2.3', digest: { sha512: TARBALL_SHA512 } },
        ],
        predicate: {
            buildDefinition: {
                buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
                externalParameters: {
                    workflow: {
                        ref: 'refs/tags/v1.2.3',
                        repository: 'https://github.com/zsumz/demo',
                        path: '.github/workflows/quoin.yml',
                    },
                },
            },
            runDetails: {
                builder: { id: 'https://github.com/actions/runner/github-hosted' },
                metadata: {
                    invocationId: 'https://github.com/zsumz/demo/actions/runs/42/attempts/1',
                },
            },
        },
    };
}

function statementV02(): Record<string, unknown> {
    return {
        _type: 'https://in-toto.io/Statement/v0.1',
        predicateType: 'https://slsa.dev/provenance/v0.2',
        subject: [
            { name: 'pkg:npm/demo@1.2.3', digest: { sha512: TARBALL_SHA512 } },
        ],
        predicate: {
            buildType: 'https://github.com/npm/cli/gha/v2',
            invocation: {
                configSource: {
                    uri: 'git+https://github.com/zsumz/demo@refs/tags/v1.2.3',
                    entryPoint: '.github/workflows/quoin.yml',
                },
            },
            runDetails: {
                metadata: {
                    invocationId: 'https://github.com/zsumz/demo/actions/runs/42/attempts/1',
                },
            },
        },
    };
}

function attestationsFor(statement: unknown, options: { certificate?: boolean } = {}): unknown {
    const material = options.certificate === false
        ? {}
        : { x509CertificateChain: { certificates: [{ rawBytes: 'Zm9vYmFy' }] } };
    return {
        package: 'demo',
        version: '1.2.3',
        attestations: [
            {
                predicateType: 'https://slsa.dev/provenance/v1',
                bundle: {
                    mediaType: 'application/vnd.dev.sigstore.bundle+json;version=0.1',
                    verificationMaterial: material,
                    dsseEnvelope: {
                        payloadType: 'application/vnd.in-toto+json',
                        payload: Buffer.from(JSON.stringify(statement), 'utf8').toString('base64'),
                    },
                },
            },
            {
                predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1',
                bundle: {},
            },
        ],
    };
}

function auditReport(): Record<string, unknown> {
    return {
        invalid: [],
        missing: [],
        verified: [
            {
                name: 'demo',
                version: '1.2.3',
                registry: 'https://registry.npmjs.org/',
                attestations: {
                    provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
                    publish: { predicateType: 'https://github.com/npm/attestation' },
                },
            },
        ],
    };
}

describe('verifyProvenanceIdentity', () => {
    it('accepts a SLSA v1 bundle from the expected source', () => {
        expect(verifyProvenanceIdentity({
            attestations: attestationsFor(statementV1()),
            expected: expected(),
        })).toStrictEqual([]);
    });

    it('accepts a SLSA v0.2 bundle from the expected source', () => {
        expect(verifyProvenanceIdentity({
            attestations: attestationsFor(statementV02()),
            expected: expected(),
        })).toStrictEqual([]);
    });

    it('accepts a bare attestation array and a tag name without refs/tags', () => {
        const bare = attestationsFor(statementV1());
        const list = (bare as { attestations: unknown[] }).attestations;
        expect(verifyProvenanceIdentity({
            attestations: list,
            expected: { ...expected(), tagRef: 'v1.2.3' },
        })).toStrictEqual([]);
    });

    it('rejects a different source repository', () => {
        const statement = statementV1();
        setWorkflow(statement, 'repository', 'https://github.com/attacker/demo');
        const failures = verifyProvenanceIdentity({
            attestations: attestationsFor(statement),
            expected: expected(),
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('Provenance repository attacker/demo');
    });

    it('rejects a different workflow path', () => {
        const statement = statementV1();
        setWorkflow(statement, 'path', '.github/workflows/release.yml');
        const failures = verifyProvenanceIdentity({
            attestations: attestationsFor(statement),
            expected: expected(),
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('.github/workflows/release.yml');
    });

    it('rejects a different tag ref', () => {
        const statement = statementV1();
        setWorkflow(statement, 'ref', 'refs/heads/main');
        const failures = verifyProvenanceIdentity({
            attestations: attestationsFor(statement),
            expected: expected(),
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('refs/heads/main');
    });

    it('rejects a subject digest that is not the candidate tarball', () => {
        const statement = statementV1();
        statement.subject = [
            { name: 'pkg:npm/demo@1.2.3', digest: { sha512: 'f'.repeat(128) } },
        ];
        expect(verifyProvenanceIdentity({
            attestations: attestationsFor(statement),
            expected: expected(),
        })).toStrictEqual([
            'Provenance subject digest does not match the candidate tarball.',
        ]);
    });

    it('rejects a subject that names another package', () => {
        const statement = statementV1();
        statement.subject = [
            { name: 'pkg:npm/other@1.2.3', digest: { sha512: TARBALL_SHA512 } },
        ];
        const failures = verifyProvenanceIdentity({
            attestations: attestationsFor(statement),
            expected: expected(),
        });
        expect(failures).toStrictEqual(['Provenance subject does not name pkg:npm/demo@1.2.3.']);
    });

    it('accepts a percent-encoded scoped subject name', () => {
        const statement = statementV1();
        statement.subject = [
            { name: 'pkg:npm/%40zsumz%2Fdemo@1.2.3', digest: { sha512: TARBALL_SHA512 } },
        ];
        expect(verifyProvenanceIdentity({
            attestations: attestationsFor(statement),
            expected: { ...expected(), packageName: '@zsumz/demo' },
        })).toStrictEqual([]);
    });

    it('rejects a bundle without a signing certificate', () => {
        const failures = verifyProvenanceIdentity({
            attestations: attestationsFor(statementV1(), { certificate: false }),
            expected: expected(),
        });
        expect(failures).toStrictEqual([
            'attestation format not recognized: the provenance bundle carries no signing certificate.',
        ]);
    });

    it('rejects a workflow run that did not produce the candidate', () => {
        const failures = verifyProvenanceIdentity({
            attestations: attestationsFor(statementV1()),
            expected: { ...expected(), runId: 99 },
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('does not identify run 99');
    });

    it('skips the run check when no run id is expected', () => {
        const { runId, ...withoutRun } = expected();
        expect(runId).toBe(42);
        expect(verifyProvenanceIdentity({
            attestations: attestationsFor(statementV1()),
            expected: withoutRun,
        })).toStrictEqual([]);
    });

    it('reports an unrecognized format instead of crashing', () => {
        expect(verifyProvenanceIdentity({ attestations: null, expected: expected() }))
            .toStrictEqual(['attestation format not recognized: no attestation list for demo@1.2.3.']);
        expect(verifyProvenanceIdentity({ attestations: { attestations: [] }, expected: expected() }))
            .toStrictEqual(['No attestations are published for demo@1.2.3.']);
        expect(verifyProvenanceIdentity({
            attestations: { attestations: [{ predicateType: 'https://example.com/other' }] },
            expected: expected(),
        })).toStrictEqual(['No SLSA provenance attestation is published for demo@1.2.3.']);
    });

    it('reports an undecodable payload as an unrecognized format', () => {
        const failures = verifyProvenanceIdentity({
            attestations: {
                attestations: [
                    {
                        predicateType: 'https://slsa.dev/provenance/v1',
                        bundle: {
                            verificationMaterial: { certificate: { rawBytes: 'Zm9v' } },
                            dsseEnvelope: { payload: 'not-base64-json' },
                        },
                    },
                ],
            },
            expected: expected(),
        });
        expect(failures).toStrictEqual([
            'attestation format not recognized: the provenance payload could not be decoded for demo@1.2.3.',
        ]);
    });

    it('reports a statement without a build definition', () => {
        const failures = verifyProvenanceIdentity({
            attestations: attestationsFor({
                predicateType: 'https://slsa.dev/provenance/v1',
                subject: [{ name: 'pkg:npm/demo@1.2.3', digest: { sha512: TARBALL_SHA512 } }],
                predicate: {},
            }),
            expected: expected(),
        });
        expect(failures).toStrictEqual([
            'attestation format not recognized: the provenance predicate has no build definition.',
        ]);
    });

    it('reports a statement without a subject', () => {
        const failures = verifyProvenanceIdentity({
            attestations: attestationsFor({
                predicateType: 'https://slsa.dev/provenance/v1',
                predicate: statementV1().predicate,
            }),
            expected: expected(),
        });
        expect(failures).toStrictEqual([
            'attestation format not recognized: the provenance statement lists no subject.',
        ]);
    });
});

describe('verifyAuditSignatures', () => {
    it('accepts a verified package with a provenance attestation', () => {
        expect(verifyAuditSignatures(auditReport(), expected())).toStrictEqual([]);
    });

    it('rejects invalid signatures', () => {
        const report = auditReport();
        report.invalid = [{ name: 'demo', version: '1.2.3' }];
        expect(verifyAuditSignatures(report, expected()))
            .toStrictEqual(['npm reported 1 invalid package signatures.']);
    });

    it('rejects missing signatures', () => {
        const report = auditReport();
        report.missing = [{ name: 'demo', version: '1.2.3' }];
        expect(verifyAuditSignatures(report, expected()))
            .toStrictEqual(['npm reported 1 missing package signatures.']);
    });

    it('rejects a report that does not cover the package', () => {
        const report = auditReport();
        report.verified = [{ name: 'demo', version: '1.2.2' }];
        expect(verifyAuditSignatures(report, expected()))
            .toStrictEqual(['npm did not verify the registry signature for demo@1.2.3.']);
    });

    it('rejects a verified package without a provenance attestation', () => {
        const report = auditReport();
        report.verified = [{ name: 'demo', version: '1.2.3', attestations: {} }];
        expect(verifyAuditSignatures(report, expected()))
            .toStrictEqual(['npm did not verify a provenance attestation for demo@1.2.3.']);
    });

    it('reports an unrecognized audit format', () => {
        expect(verifyAuditSignatures(null, expected()))
            .toStrictEqual(['attestation format not recognized: npm audit signatures output was not an object.']);
        expect(verifyAuditSignatures({}, expected()))
            .toStrictEqual(['attestation format not recognized: npm audit signatures reported no verified list.']);
    });
});

describe('runAuditSignatures', () => {
    it('runs npm audit signatures with attestations in the install dir', () => {
        const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
        const exec: CommandRunner = (command, args, options) => {
            calls.push({ command, args, cwd: options.cwd });
            return { stdout: JSON.stringify(auditReport()), stderr: '' };
        };
        const outcome = runAuditSignatures({
            exec,
            installDir: '/tmp/audit',
            cacheDir: '/tmp/audit/.npm-cache',
        });
        expect(outcome.ok).toBe(true);
        expect(calls).toStrictEqual([{
            command: 'npm',
            args: [
                'audit',
                'signatures',
                '--include-attestations',
                '--json',
                '--cache',
                '/tmp/audit/.npm-cache',
            ],
            cwd: '/tmp/audit',
        }]);
    });

    it('reports a nonzero npm exit as a failure', () => {
        const exec: CommandRunner = () => {
            throw new Error('Command failed: npm audit signatures');
        };
        const outcome = runAuditSignatures({ exec, installDir: '/tmp/audit' });
        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? [] : outcome.failures[0])
            .toContain('npm audit signatures failed');
    });

    it('reports non-JSON output as an unrecognized format', () => {
        const exec: CommandRunner = (): CommandResult => ({ stdout: 'not json', stderr: '' });
        const outcome = runAuditSignatures({ exec, installDir: '/tmp/audit' });
        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? [] : outcome.failures)
            .toStrictEqual(['attestation format not recognized: npm audit signatures did not emit JSON.']);
    });
});

describe('verifyRegistryProvenance', () => {
    it('passes when npm and the registry agree on the identity', async () => {
        const urls: string[] = [];
        const fetchJson: FetchJson = async (url) => {
            urls.push(url);
            return Promise.resolve({ status: 200, body: attestationsFor(statementV1()) });
        };
        const exec: CommandRunner = (): CommandResult => ({
            stdout: JSON.stringify(auditReport()),
            stderr: '',
        });
        const result = await verifyRegistryProvenance({
            exec,
            fetchJson,
            installDir: '/tmp/audit',
            registry: 'https://registry.npmjs.org',
            expected: expected(),
        });
        expect(result).toStrictEqual({ ok: true });
        expect(urls).toStrictEqual([
            'https://registry.npmjs.org/-/npm/v1/attestations/demo@1.2.3',
        ]);
    });

    it('collects audit and identity failures together', async () => {
        const fetchJson: FetchJson = async () => Promise.resolve({
            status: 200,
            body: attestationsFor(statementV1()),
        });
        const exec: CommandRunner = (): CommandResult => ({ stdout: '{}', stderr: '' });
        const result = await verifyRegistryProvenance({
            exec,
            fetchJson,
            installDir: '/tmp/audit',
            registry: 'https://registry.npmjs.org',
            expected: { ...expected(), workflowPath: '.github/workflows/other.yml' },
        });
        expect(result.ok).toBe(false);
        expect(result.ok ? [] : result.failures).toHaveLength(2);
    });

    it('fails closed when the registry publishes no attestations', async () => {
        const fetchJson: FetchJson = async () => Promise.resolve({ status: 404, body: null });
        const exec: CommandRunner = (): CommandResult => ({
            stdout: JSON.stringify(auditReport()),
            stderr: '',
        });
        const result = await verifyRegistryProvenance({
            exec,
            fetchJson,
            installDir: '/tmp/audit',
            registry: 'https://registry.npmjs.org',
            expected: expected(),
        });
        expect(result.ok).toBe(false);
        expect(result.ok ? [] : result.failures[0]).toContain('no attestation list');
    });

    it('reports a failing attestation download', async () => {
        const fetchJson: FetchJson = async () => Promise.resolve({ status: 500, body: null });
        const exec: CommandRunner = (): CommandResult => ({
            stdout: JSON.stringify(auditReport()),
            stderr: '',
        });
        const result = await verifyRegistryProvenance({
            exec,
            fetchJson,
            installDir: '/tmp/audit',
            registry: 'https://registry.npmjs.org',
            expected: expected(),
        });
        expect(result.ok).toBe(false);
        expect(result.ok ? [] : result.failures[0]).toContain('Attestation download failed');
    });
});

function setWorkflow(statement: Record<string, unknown>, key: string, value: string): void {
    const predicate = statement.predicate as {
        buildDefinition: { externalParameters: { workflow: Record<string, string> } };
    };
    predicate.buildDefinition.externalParameters.workflow[key] = value;
}
