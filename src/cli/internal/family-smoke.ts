import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    hashTarball,
    verifyTarballUnchanged,
    type TarballDigest,
} from '../../candidate/inspect.ts';
import type { FamilyCandidateReceipt } from '../../candidate/receipt.ts';
import { ensureDirectory, errorMessage, jsonDocument } from '../support.ts';
import type { CliEffects } from './effects.ts';

export interface FamilySmokePackage {
    member: FamilyCandidateReceipt['packages'][number];
    bytes: Buffer;
}

export interface FamilySmokeRequest {
    consumerDir: string;
    directory: string;
    family: FamilyCandidateReceipt['family'];
    packages: readonly FamilySmokePackage[];
    effects: CliEffects;
}

export async function runFamilyReleaseSmoke(
    request: FamilySmokeRequest,
): Promise<string[]> {
    await ensureDirectory(request.directory);
    const copies: Array<{ file: string; before: TarballDigest }> = [];
    const manifestPackages = [];
    for (const [index, entry] of request.packages.entries()) {
        const file = path.join(request.directory, 'smoke-package-' + String(index + 1) + '.tgz');
        const before = hashTarball(entry.bytes);
        await writeFile(file, entry.bytes);
        copies.push({ file, before });
        manifestPackages.push({
            directory: entry.member.directory,
            name: entry.member.name,
            version: entry.member.version,
            distTag: entry.member.distTag,
            tarball: file,
            sha256: before.sha256,
        });
    }
    const manifest = path.join(request.directory, 'packages.json');
    await writeFile(manifest, jsonDocument({
        family: request.family,
        packages: manifestPackages,
    }));
    const failures: string[] = [];
    try {
        request.effects.exec('npm', ['run', 'release:smoke'], {
            cwd: request.consumerDir,
            env: {
                ...request.effects.env,
                SALLYPORT_PACKAGES: manifest,
                SALLYPORT_VERSION: request.family.version,
                SALLYPORT_DIST_TAG: request.family.distTag,
            },
        });
    } catch (error) {
        failures.push(errorMessage(error));
    }
    for (const copy of copies) failures.push(...await unchanged(copy.file, copy.before));
    return failures;
}

async function unchanged(file: string, before: TarballDigest): Promise<string[]> {
    let bytes: Buffer;
    try {
        bytes = await readFile(file);
    } catch {
        return ['the smoke run removed ' + file + '.'];
    }
    const result = verifyTarballUnchanged({ before, afterBuffer: bytes });
    return result.unchanged ? [] : result.failures.map((line) => file + ': ' + line);
}
