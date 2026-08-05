import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatCheckReport, runCheck, SIGNING_KEY_FILE } from '../../../src/cli/check.ts';
import { runInit } from '../../../src/cli/init.ts';
import type { CommandRunner } from '../../../src/contract/signing.ts';
import { runCommand } from '../../../src/report/exec.ts';
import {
    createConsumer,
    FIXTURE_SHA,
    makeTempRoot,
    removeTempRoot,
    writeTextFile,
    type Consumer,
} from './fixture.ts';

const FINGERPRINT = '1234567890ABCDEF1234567890ABCDEF12345678';
const REMOTE_IDS = [
    'remote-environments',
    'remote-npm-trust',
    'remote-npm-mfa',
    'remote-immutable-releases',
    'remote-signer-variable',
    'remote-rulesets',
];

let root = '';
let consumer: Consumer;

beforeEach(async () => {
    root = makeTempRoot('check-remote');
    consumer = createConsumer(root);
    writeTextFile(path.join(consumer.dir, SIGNING_KEY_FILE), 'PUBLIC KEY\n');
    await runInit({
        dir: consumer.dir,
        strict: true,
        upgrade: false,
        force: false,
        sha: FIXTURE_SHA,
        exec: runCommand,
        log: () => undefined,
    });
});

afterEach(() => {
    removeTempRoot(root);
});

describe('runCheck remote posture', () => {
    it('passes all six checks for a complete authenticated posture', async () => {
        const report = await runCheck({
            dir: consumer.dir,
            exec: remoteRunner(),
            remote: true,
        });
        const remote = report.checks.filter((check) => check.id.startsWith('remote-'));

        expect(remote.map((check) => check.id)).toEqual(REMOTE_IDS);
        expect(remote.map((check) => check.status)).toEqual(REMOTE_IDS.map(() => 'pass'));
        expect(report.ok).toBe(true);
    });

    it('reports unauthenticated settings as UNVERIFIED and exits fail-closed', async () => {
        const exec: CommandRunner = (command, args, options) => {
            if (command === 'git') {
                return runCommand(command, args, options);
            }
            throw new Error('401 Unauthorized');
        };
        const report = await runCheck({ dir: consumer.dir, exec, remote: true });
        const remote = report.checks.filter((check) => check.id.startsWith('remote-'));

        expect(remote.map((check) => check.status)).toEqual(
            REMOTE_IDS.map(() => 'unverified'),
        );
        expect(report.ok).toBe(false);
        expect(formatCheckReport(report)).toContain('UNVERIFIED npm trusted publisher is stage-only');
    });

    it('fails settings that are readable but unsafe', async () => {
        const report = await runCheck({
            dir: consumer.dir,
            exec: remoteRunner({ unsafe: true }),
            remote: true,
        });
        const status = Object.fromEntries(report.checks.map((check) => [check.id, check.status]));

        expect(status['remote-environments']).toBe('fail');
        expect(status['remote-npm-trust']).toBe('fail');
        expect(status['remote-npm-mfa']).toBe('fail');
        expect(status['remote-immutable-releases']).toBe('fail');
        expect(status['remote-signer-variable']).toBe('fail');
        expect(status['remote-rulesets']).toBe('fail');
        expect(report.ok).toBe(false);
    });

    it('accepts npm API shapes and an explicit default-branch rule', async () => {
        const report = await runCheck({
            dir: consumer.dir,
            exec: remoteRunner({ alternateShapes: true }),
            remote: true,
        });

        expect(report.checks.filter((check) => check.id.startsWith('remote-'))
            .every((check) => check.status === 'pass')).toBe(true);
        expect(report.ok).toBe(true);
    });
});

function remoteRunner(
    options: { unsafe?: boolean; alternateShapes?: boolean } = {},
): CommandRunner {
    const unsafe = options.unsafe === true;
    const routes = remoteRoutes(unsafe, options.alternateShapes === true);
    return (command, args, commandOptions) => {
        if (command === 'git') {
            return runCommand(command, args, commandOptions);
        }
        if (command === 'gpg') {
            return {
                stdout: `fpr:::::::::${unsafe ? 'A'.repeat(40) : FINGERPRINT}:\n`,
                stderr: '',
            };
        }
        const value = routes.get(`${command} ${args.join(' ')}`);
        if (value === undefined) {
            throw new Error(`401 Unauthorized: ${command} ${args.join(' ')}`);
        }
        return { stdout: JSON.stringify(value), stderr: '' };
    };
}

function remoteRoutes(unsafe: boolean, alternateShapes: boolean): Map<string, unknown> {
    return new Map<string, unknown>([
        ['gh api repos/zsumz/fake', { default_branch: 'main' }],
        ['gh api repos/zsumz/fake/environments', environments(unsafe)],
        ['gh api repos/zsumz/fake/environments/npm-stage/deployment-branch-policies', {
            branch_policies: [{ name: unsafe ? 'main' : 'v*', type: unsafe ? 'branch' : 'tag' }],
        }],
        ['gh api repos/zsumz/fake/environments/npm-stage/secrets', {
            total_count: unsafe ? 1 : 0,
        }],
        ['gh api repos/zsumz/fake/environments/github-release/deployment-branch-policies', {
            branch_policies: [{ name: 'main', type: 'branch' }],
        }],
        ['gh api repos/zsumz/fake/environments/github-release/secrets', { total_count: 0 }],
        ['npm trust list sallyport-fixture --json', npmTrust(unsafe, alternateShapes)],
        ['npm access get mfa sallyport-fixture --json', alternateShapes
            ? { 'sallyport-fixture': 'publish' }
            : {
                publish_requires_tfa: !unsafe,
                automation_token_overrides_tfa: unsafe,
            }],
        ['gh api repos/zsumz/fake/immutable-releases', { enabled: !unsafe }],
        ['gh api repos/zsumz/fake/actions/variables/SALLYPORT_SIGNER_FINGERPRINT', {
            value: FINGERPRINT,
        }],
        ['gh api repos/zsumz/fake/rulesets', [
            { id: 1, target: 'branch', enforcement: 'active' },
            { id: 2, target: 'tag', enforcement: 'active' },
        ]],
        ['gh api repos/zsumz/fake/rulesets/1', branchRuleset(unsafe, alternateShapes)],
        ['gh api repos/zsumz/fake/rulesets/2', tagRuleset(unsafe)],
    ]);
}

function environments(unsafe: boolean): unknown {
    return {
        environments: [
            {
                name: 'npm-stage',
                deployment_branch_policy: { custom_branch_policies: !unsafe },
            },
            {
                name: 'github-release',
                deployment_branch_policy: { custom_branch_policies: true },
            },
        ],
    };
}

function npmTrust(unsafe: boolean, alternateShapes: boolean): unknown {
    if (alternateShapes) {
        return [{
            type: 'github',
            claims: {
                repository: 'zsumz/fake',
                workflow_ref: { file: 'sallyport.yml' },
                environment: 'npm-stage',
            },
            permissions: ['createStagedPackage'],
        }];
    }
    return {
        type: 'github',
        repository: 'zsumz/fake',
        file: 'sallyport.yml',
        environment: 'npm-stage',
        permissions: [unsafe ? 'createPackage' : 'createStagedPackage'],
    };
}

function branchRuleset(unsafe: boolean, explicitBranch: boolean): unknown {
    const types = unsafe
        ? ['deletion']
        : [
            'deletion',
            'non_fast_forward',
            'pull_request',
            'required_linear_history',
            'required_signatures',
        ];
    const statusRules = unsafe ? [] : [{
        type: 'required_status_checks',
        parameters: { required_status_checks: [{ context: 'CI' }] },
    }];
    return {
        conditions: {
            ref_name: { include: [explicitBranch ? 'refs/heads/main' : '~DEFAULT_BRANCH'] },
        },
        rules: [
            ...types.map((type) => ({ type })),
            ...statusRules,
        ],
    };
}

function tagRuleset(unsafe: boolean): unknown {
    return {
        conditions: { ref_name: { include: ['refs/tags/v*'] } },
        rules: (unsafe ? ['deletion'] : ['deletion', 'non_fast_forward', 'update'])
            .map((type) => ({ type })),
    };
}
