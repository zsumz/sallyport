import path from 'node:path';

import { normalizeRepositoryUrl } from '../../contract/package.ts';
import { RELEASE_NOTES_DIRECTORY } from '../../contract/release.ts';
import type { CommandRunner } from '../../contract/signing.ts';
import { SIGNING_KEY_FILE } from '../check.ts';
import {
    errorMessage,
    readJsonFile,
    readStringMap,
} from '../support.ts';
import type { Profile } from '../template.ts';

const REQUIRED_SCRIPTS = ['release:check', 'release:smoke'] as const;

export function npmTrustCommand(packageName: string, repository: string): string[] {
    return [
        `npm trust github ${packageName} \\`,
        `  --repository ${repository} \\`,
        '  --file quoin.yml \\',
        '  --environment npm-stage \\',
        '  --allow-stage-publish',
    ];
}

export function setupChecklist(profile: Profile, version: string): string[] {
    const steps = [
        'Create the npm-stage environment; restrict deployment refs to v* tags; no secrets.',
        'Create the github-release environment; restrict deployment refs to the default branch; no secrets.',
        ...profile === 'strict'
            ? [
                'Set repository variable QUOIN_SIGNER_FINGERPRINT to the 40-hex primary key fingerprint.',
                `Commit the public release signing key to ${SIGNING_KEY_FILE}.`,
            ]
            : [],
        'Run the npm trust command above; npm allows one trusted publisher per package.',
        'Set npm publishing access to require two-factor authentication and disallow tokens.',
        'Remove obsolete npm automation tokens.',
        `Commit release notes to ${RELEASE_NOTES_DIRECTORY}/v${version}.md before tagging.`,
    ];
    return [
        'One-time repository setup:',
        ...steps.map((step, index) => `  ${String(index + 1)}. ${step}`),
    ];
}

export function detectRepository(dir: string, exec: CommandRunner): string {
    let url: string;
    try {
        url = exec('git', ['remote', 'get-url', 'origin'], { cwd: dir }).stdout.trim();
    } catch (error) {
        throw new Error(
            `Installation failed: git remote get-url origin failed: ${errorMessage(error).split('\n')[0] ?? ''}`,
            { cause: error },
        );
    }
    const repository = url === '' ? null : normalizeRepositoryUrl(url);
    if (repository === null) {
        throw new Error(
            `Installation failed: git remote origin ${url} must identify a github.com repository.`,
        );
    }
    return repository;
}

export async function scriptWarnings(dir: string): Promise<string[]> {
    const manifest = await readJsonFile(path.join(dir, 'package.json'));
    const scripts = readStringMap(manifest, 'scripts');
    return REQUIRED_SCRIPTS
        .filter((script) => {
            const value = scripts[script];
            return value === undefined || value.trim() === '';
        })
        .map((script) => `package.json defines no ${script} script; quoin cannot release without it.`);
}

export function declaredRepositoryMismatch(
    declared: string | undefined,
    repository: string,
): boolean {
    if (declared === undefined || declared.trim() === '') {
        return true;
    }
    const normalized = normalizeRepositoryUrl(declared);
    return normalized?.toLowerCase() !== repository.toLowerCase();
}
