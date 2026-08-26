import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { assertCandidateTarball, hashTarball } from '../../../candidate/inspect.ts';
import {
    buildFamilyCandidateReceipt,
    candidateTarballFilename,
    type FamilyCandidateReceipt,
} from '../../../candidate/receipt.ts';
import type { ReleaseMetadata } from '../../../contract/package.ts';
import { failure } from '../../support.ts';
import type { CandidateIdentity } from './family-model.ts';
import { assertStagedTarball } from './policy.ts';

export async function createFamilyReceipt(
    release: ReleaseMetadata,
    candidateDir: string,
    identity: CandidateIdentity,
): Promise<FamilyCandidateReceipt> {
    const name = release.root.name;
    const version = release.root.version;
    if (name === undefined || version === undefined) {
        throw failure('Candidate receipt failed:', [
            'package.json must declare both a name and a version.',
        ]);
    }
    const packages: FamilyCandidateReceipt['packages'] = [];
    for (const [index, member] of release.packages.entries()) {
        if (member.name === undefined || member.version === undefined) {
            throw failure('Candidate receipt failed:', [
                member.directory + '/package.json must declare a name and version.',
            ]);
        }
        const filename = candidateTarballFilename(index, release.packages.length);
        const tarballPath = path.join(candidateDir, filename);
        const bytes = await readFile(tarballPath);
        const manifest = assertCandidateTarball(bytes);
        if (manifest.name !== member.name || manifest.version !== member.version) {
            throw failure('Candidate receipt failed:', [
                filename + ' is ' + manifest.name + '@' + manifest.version
                + ', expected ' + member.name + '@' + member.version + '.',
            ]);
        }
        const digest = hashTarball(bytes);
        await assertStagedTarball(tarballPath, digest);
        packages.push({
            directory: member.directory,
            name: member.name,
            version: member.version,
            access: 'public',
            distTag: identity.distTag,
            tarball: { filename, ...digest },
        });
    }
    return buildFamilyCandidateReceipt({
        sallyport: identity.sallyport,
        repository: identity.repository,
        source: identity.source,
        family: { name, version, distTag: identity.distTag },
        packages,
        run: identity.run,
    });
}
