import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertCandidateTarball, hashTarball } from '../../candidate/inspect.ts';
import { packOnce } from '../../candidate/pack.ts';
import { readPackageMetadata } from '../../contract/package.ts';
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

    const metadata = await readPackageMetadata(consumerDir);
    const packed = packOnce({ consumerDir, outputDir, exec: effects.exec });
    const bytes = await readFile(packed.tarballPath);
    const digest = hashTarball(bytes);
    const manifest = assertCandidateTarball(bytes);

    const failures: string[] = [];
    if (manifest.name !== metadata.name) {
        failures.push(
            `packed manifest name ${manifest.name} does not match package.json ${metadata.name ?? 'nothing'}.`,
        );
    }
    if (manifest.version !== metadata.version) {
        failures.push(
            `packed manifest version ${manifest.version} does not match package.json ${metadata.version ?? 'nothing'}.`,
        );
    }
    if (failures.length > 0) {
        throw failure('Candidate pack failed:', failures);
    }

    await effects.writeOutput({
        tarball: packed.tarballPath,
        bytes: String(digest.bytes),
        sha256: digest.sha256,
        sha512: digest.sha512,
        integrity: digest.integrity,
    });
    effects.log(
        `Packed ${manifest.name}@${manifest.version} once as ${packed.tarballPath}`
        + ` (${String(digest.bytes)} bytes, sha256 ${digest.sha256}).`,
    );
}
