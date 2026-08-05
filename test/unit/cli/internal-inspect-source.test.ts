import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectSourceCommand } from '../../../src/cli/internal/inspect-source.ts';
import type { JsonResponse } from '../../../src/registry/download.ts';
import {
    createConsumer,
    createEffects,
    failingRegistry,
    jsonRegistry,
    makeTempRoot,
    removeTempRoot,
    type Consumer,
} from './fixture.ts';

const REPOSITORY_ID = '1286348597';

let root = '';
let consumer: Consumer;

beforeEach(() => {
    root = makeTempRoot('inspect');
    consumer = createConsumer(root);
});

afterEach(() => {
    removeTempRoot(root);
});

function args(overrides: Partial<Record<string, string>> = {}): string[] {
    const values: Record<string, string> = {
        '--consumer': consumer.dir,
        '--profile': 'standard',
        '--tag': `v${consumer.version}`,
        '--repository': 'zsumz/fake',
        '--repository-id': REPOSITORY_ID,
        '--default-branch-ref': 'main',
        '--expected-commit': consumer.commit,
        ...overrides,
    };
    return Object.entries(values).flatMap(([flag, value]) => [flag, value]);
}

function absentRegistry(): JsonResponse {
    return { status: 404, body: null };
}

function presentRegistry(version: string): JsonResponse {
    return {
        status: 200,
        body: {
            name: consumer.name,
            versions: {
                [version]: {
                    version,
                    dist: {
                        tarball: `https://registry.npmjs.org/${consumer.name}/-/x-${version}.tgz`,
                        integrity: `sha512-${'A'.repeat(86)}==`,
                        shasum: 'a'.repeat(40),
                    },
                },
            },
        },
    };
}

describe('internal inspect-source', () => {
    it('accepts a valid unsigned standard release and reports the derived values', async () => {
        const harness = createEffects(root, { registry: jsonRegistry(absentRegistry) });

        await inspectSourceCommand(args(), harness.effects);

        expect(harness.outputs).toEqual([{
            package_name: consumer.name,
            package_version: consumer.version,
            dist_tag: 'latest',
        }]);
        expect(harness.summaries.join('')).toContain('| Dist-tag | `latest` |');
        expect(harness.summaries.join('')).toContain('| Mode | `stage` |');
    });

    it('derives the prerelease dist-tag from the first identifier', async () => {
        const alphaRoot = makeTempRoot('inspect-alpha');
        const alpha = createConsumer(alphaRoot, { version: '2.0.0-alpha.4' });
        const harness = createEffects(alphaRoot, { registry: jsonRegistry(absentRegistry) });

        await inspectSourceCommand(
            args({
                '--consumer': alpha.dir,
                '--tag': 'v2.0.0-alpha.4',
                '--expected-commit': alpha.commit,
            }),
            harness.effects,
        );

        expect(harness.outputs[0]?.dist_tag).toBe('alpha');
        removeTempRoot(alphaRoot);
    });

    it('fails when the registry already carries the version', async () => {
        const harness = createEffects(root, {
            registry: jsonRegistry(() => presentRegistry(consumer.version)),
        });

        await expect(inspectSourceCommand(args(), harness.effects))
            .rejects.toThrow(`the npm registry already contains ${consumer.name}@${consumer.version}.`);
    });

    it('fails when the registry cannot be queried', async () => {
        const harness = createEffects(root, {
            registry: jsonRegistry(() => ({ status: 500, body: null })),
        });

        await expect(inspectSourceCommand(args(), harness.effects))
            .rejects.toThrow(/the npm registry could not be queried/u);
    });

    it('skips the registry absence check in finalize mode', async () => {
        const harness = createEffects(root, { registry: failingRegistry() });

        await inspectSourceCommand(args({ '--mode': 'finalize' }), harness.effects);

        expect(harness.outputs[0]?.package_version).toBe(consumer.version);
        expect(harness.summaries.join('')).toContain('| Mode | `finalize` |');
    });

    it('accepts the finalize mode through SALLYPORT_MODE', async () => {
        const harness = createEffects(root, { registry: failingRegistry() });
        const effects = {
            ...harness.effects,
            env: { ...harness.effects.env, SALLYPORT_MODE: 'finalize' },
        };

        await inspectSourceCommand(args(), effects);

        expect(harness.outputs).toHaveLength(1);
    });

    it('rejects an unknown mode', async () => {
        const harness = createEffects(root, { registry: failingRegistry() });

        await expect(inspectSourceCommand(args({ '--mode': 'audit' }), harness.effects))
            .rejects.toThrow('--mode must be stage or finalize, found audit.');
    });

    it('fails when the tag does not match the package version', async () => {
        const harness = createEffects(root, { registry: jsonRegistry(absentRegistry) });

        await expect(inspectSourceCommand(args({ '--tag': 'v9.9.9' }), harness.effects))
            .rejects.toThrow('release tag v9.9.9 must be v1.2.3.');
    });

    it('fails when the repository does not match package.json', async () => {
        const harness = createEffects(root, { registry: jsonRegistry(absentRegistry) });

        await expect(inspectSourceCommand(
            args({ '--repository': 'zsumz/elsewhere' }),
            harness.effects,
        )).rejects.toThrow('package.json repository zsumz/fake must be zsumz/elsewhere.');
    });

    it('fails when the release notes are missing', async () => {
        rmSync(path.join(consumer.dir, 'docs'), { recursive: true, force: true });
        const harness = createEffects(root, { registry: jsonRegistry(absentRegistry) });

        await expect(inspectSourceCommand(args(), harness.effects))
            .rejects.toThrow('docs/releases/v1.2.3.md must contain release notes.');
    });

    it('fails when the tag is not reachable from the default branch', async () => {
        const harness = createEffects(root, { registry: jsonRegistry(absentRegistry) });

        await expect(inspectSourceCommand(
            args({ '--default-branch-ref': 'release-branch' }),
            harness.effects,
        )).rejects.toThrow(/must point to a commit reachable from release-branch/u);
    });

    it('requires a signer fingerprint under the strict profile', async () => {
        const harness = createEffects(root, { registry: jsonRegistry(absentRegistry) });

        await expect(inspectSourceCommand(args({ '--profile': 'strict' }), harness.effects))
            .rejects.toThrow(/requires a 40-hexadecimal signer fingerprint/u);
    });

    it('rejects an unsigned tag under the strict profile', async () => {
        const harness = createEffects(root, { registry: jsonRegistry(absentRegistry) });

        await expect(inspectSourceCommand(
            args({ '--profile': 'strict', '--signer-fingerprint': 'B'.repeat(40) }),
            harness.effects,
        )).rejects.toThrow(/must carry a good OpenPGP signature/u);
    });

    it('rejects an unknown profile', async () => {
        const harness = createEffects(root, { registry: failingRegistry() });

        await expect(inspectSourceCommand(args({ '--profile': 'paranoid' }), harness.effects))
            .rejects.toThrow('Profile must be standard or strict, found paranoid.');
    });

    it('requires every frozen flag', async () => {
        const harness = createEffects(root, { registry: failingRegistry() });

        await expect(inspectSourceCommand(['--consumer', consumer.dir], harness.effects))
            .rejects.toThrow('Argument parsing failed: --profile is required.');
    });
});
