import type { CommandResult } from '../../report/exec.ts';
import {
    errorMessage,
    readArrayProperty,
    readProperty,
    readStringProperty,
} from '../download.ts';
import {
    UNRECOGNIZED,
    type AuditProof,
    type AuditOutcome,
    type AuditSignaturesInput,
    type ExpectedProvenance,
} from './model.ts';

export function runAuditSignatures(input: AuditSignaturesInput): AuditOutcome {
    const args = [
        'audit',
        'signatures',
        '--include-attestations',
        '--json',
    ];
    if (input.cacheDir !== undefined) {
        args.push('--cache', input.cacheDir);
    }
    let result: CommandResult;
    try {
        result = input.exec('npm', args, { cwd: input.installDir });
    } catch (error) {
        return { ok: false, failures: [`npm audit signatures failed: ${errorMessage(error)}`] };
    }
    try {
        return { ok: true, report: JSON.parse(result.stdout) as unknown };
    } catch {
        return {
            ok: false,
            failures: [`${UNRECOGNIZED}: npm audit signatures did not emit JSON.`],
        };
    }
}

export function verifyAuditProof(
    report: unknown,
    expected: ExpectedProvenance,
): AuditProof {
    const label = `${expected.packageName}@${expected.packageVersion}`;
    if (typeof report !== 'object' || report === null) {
        return {
            failures: [`${UNRECOGNIZED}: npm audit signatures output was not an object.`],
            provenanceBundle: null,
        };
    }
    const failures: string[] = [];
    failures.push(...unverifiedFailures(report, 'invalid'));
    failures.push(...unverifiedFailures(report, 'missing'));
    const verified = readArrayProperty(report, 'verified');
    if (verified === null) {
        failures.push(`${UNRECOGNIZED}: npm audit signatures reported no verified list.`);
        return { failures, provenanceBundle: null };
    }
    const entries = verified.filter(
        (value) => readStringProperty(value, 'name') === expected.packageName
            && readStringProperty(value, 'version') === expected.packageVersion,
    );
    if (entries.length === 0) {
        failures.push(`npm did not verify the registry signature for ${label}.`);
        return { failures, provenanceBundle: null };
    }
    if (entries.length !== 1) {
        failures.push(`${UNRECOGNIZED}: npm reported duplicate verified entries for ${label}.`);
        return { failures, provenanceBundle: null };
    }
    const entry = entries[0];
    const provenance = readProperty(readProperty(entry, 'attestations'), 'provenance');
    if (typeof provenance !== 'object' || provenance === null) {
        failures.push(`npm did not verify a provenance attestation for ${label}.`);
        return { failures, provenanceBundle: null };
    }
    const bundles = readArrayProperty(entry, 'attestationBundles');
    if (bundles === null) {
        failures.push(`${UNRECOGNIZED}: npm returned no verified attestation bundles for ${label}.`);
        return { failures, provenanceBundle: null };
    }
    const provenanceBundles = bundles.filter(
        (value) => readStringProperty(value, 'predicateType')?.includes('slsa.dev/provenance') === true,
    );
    if (provenanceBundles.length === 0) {
        failures.push(`npm returned no verified provenance bundle for ${label}.`);
        return { failures, provenanceBundle: null };
    }
    if (provenanceBundles.length !== 1) {
        failures.push(`${UNRECOGNIZED}: npm returned multiple verified provenance bundles for ${label}.`);
        return { failures, provenanceBundle: null };
    }
    const bundle = readProperty(provenanceBundles[0], 'bundle');
    if (typeof bundle !== 'object' || bundle === null) {
        failures.push(`${UNRECOGNIZED}: npm returned an invalid verified provenance bundle for ${label}.`);
        return { failures, provenanceBundle: null };
    }
    return { failures, provenanceBundle: bundle };
}

function unverifiedFailures(report: unknown, key: string): string[] {
    const entries = readArrayProperty(report, key);
    if (entries === null || entries.length === 0) {
        return [];
    }
    return [`npm reported ${String(entries.length)} ${key} package signatures.`];
}
