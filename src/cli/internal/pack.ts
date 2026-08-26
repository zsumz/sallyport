import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertCandidateTarball, hashTarball } from '../../candidate/inspect.ts';
import { packOnce } from '../../candidate/pack.ts';
import { candidateTarballFilename } from '../../candidate/receipt.ts';
import { readReleaseMetadata } from '../../contract/package.ts';
import { parseArgv, requireValue } from '../args.ts';
import { ensureDirectory, failure } from '../support.ts';
import type { CliEffects } from './effects.ts';

export async function packCommand(
    argv: readonly string[],
    effects: CliEffects,
): Promise<void> {
    const parsed = parseArgv(argv, { strings: ['consumer', 'output'] });
    const consumerDir = path.resolve(requireValue(parsed, 'consumer'));
    const outputDir = path.resolve(requireValue(parsed, 'output'));
    await ensureDirectory(outputDir);

    const release = await readReleaseMetadata(consumerDir);
    const failures: string[] = [];
    if (release.configurationFailures.length > 0) {
        throw failure('Candidate pack failed:', [...release.configurationFailures]);
    }
    const outputs: Record<string, string> = {
        package_count: String(release.packages.length),
        release_version: release.root.version ?? '',
    };
    for (const [index, member] of release.packages.entries()) {
        const filename = candidateTarballFilename(index, release.packages.length);
        const packed = packOnce({
            consumerDir: path.join(consumerDir, member.directory),
            outputDir,
            filename,
            exec: effects.exec,
        });
        const bytes = await readFile(packed.tarballPath);
        const digest = hashTarball(bytes);
        const manifest = assertCandidateTarball(bytes);
        if (manifest.name !== member.name) {
            failures.push(
                'packed manifest name ' + manifest.name
                + ' does not match package.json ' + (member.name ?? 'nothing') + '.',
            );
        }
        if (manifest.version !== member.version) {
            failures.push(
                'packed manifest version ' + manifest.version
                + ' does not match package.json ' + (member.version ?? 'nothing') + '.',
            );
        }
        if (!release.isFamily) {
            Object.assign(outputs, {
                tarball: packed.tarballPath,
                bytes: String(digest.bytes),
                sha256: digest.sha256,
                sha512: digest.sha512,
                integrity: digest.integrity,
            });
        }
        effects.log(
            'Packed ' + manifest.name + '@' + manifest.version + ' once as '
            + packed.tarballPath + ' (' + String(digest.bytes)
            + ' bytes, sha256 ' + digest.sha256 + ').',
        );
    }
    if (failures.length > 0) {
        throw failure('Candidate pack failed:', failures);
    }
    await effects.writeOutput(outputs);
}
