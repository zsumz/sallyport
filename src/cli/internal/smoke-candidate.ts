import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isFamilyCandidateReceipt } from '../../candidate/receipt.ts';
import type { CliEffects } from './effects.ts';
import { runFamilyReleaseSmoke } from './family-smoke.ts';
import { parseReceipt, tarballFailures } from './fetch-candidate.ts';
import { failure } from '../support.ts';

interface SingleSmokeRequest {
    consumerDir: string;
    tarball: Buffer;
    directory: string;
    packageName: string;
    version: string;
    distTag: string;
    effects: CliEffects;
}

interface CandidateSmokeRequest {
    candidateDir: string;
    consumerDir: string;
    effects: CliEffects;
    runSingle: (request: SingleSmokeRequest) => Promise<{ copyPath: string; failures: string[] }>;
}

export async function smokeCandidateDirectory(request: CandidateSmokeRequest): Promise<void> {
    const receipt = parseReceipt(await readFile(path.join(request.candidateDir, 'candidate.json')));
    const names = isFamilyCandidateReceipt(receipt)
        ? receipt.packages.map((member) => member.tarball.filename) : ['package.tgz'];
    const tarballs = await readTarballs(request.candidateDir, names);
    const failures = tarballFailures(tarballs, receipt);
    const directory = path.join(
        request.effects.env.RUNNER_TEMP ?? tmpdir(),
        'sallyport-smoke',
    );
    if (isFamilyCandidateReceipt(receipt)) {
        failures.push(...await runFamilyReleaseSmoke({
            consumerDir: request.consumerDir,
            directory,
            family: receipt.family,
            packages: receipt.packages.map((member) => ({
                member,
                bytes: requiredTarball(tarballs, member.tarball.filename),
            })),
            effects: request.effects,
        }));
    } else {
        const outcome = await request.runSingle({
            consumerDir: request.consumerDir,
            tarball: requiredTarball(tarballs, 'package.tgz'),
            directory,
            packageName: receipt.package.name,
            version: receipt.package.version,
            distTag: receipt.package.distTag,
            effects: request.effects,
        });
        failures.push(...outcome.failures);
    }
    failures.push(...tarballFailures(await readTarballs(request.candidateDir, names), receipt));
    if (failures.length > 0) {
        throw failure('Candidate smoke failed for ' + releaseLabel(receipt) + ':', failures);
    }
    request.effects.log(
        'Smoked ' + releaseLabel(receipt)
        + '; every authoritative candidate tarball is unchanged.',
    );
}

async function readTarballs(
    directory: string,
    names: readonly string[],
): Promise<Map<string, Uint8Array>> {
    const tarballs: Map<string, Uint8Array> = new Map();
    for (const name of names) tarballs.set(name, await readFile(path.join(directory, name)));
    return tarballs;
}

function requiredTarball(tarballs: ReadonlyMap<string, Uint8Array>, name: string): Buffer {
    const bytes = tarballs.get(name);
    if (bytes === undefined) {
        throw failure('Candidate smoke failed:', ['candidate is missing ' + name + '.']);
    }
    return Buffer.from(bytes);
}

function releaseLabel(receipt: ReturnType<typeof parseReceipt>): string {
    return isFamilyCandidateReceipt(receipt)
        ? receipt.family.name + '@' + receipt.family.version
        : receipt.package.name + '@' + receipt.package.version;
}
