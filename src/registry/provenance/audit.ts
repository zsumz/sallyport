import type { CommandResult } from '../../report/exec.ts';
import {
    errorMessage,
    readArrayProperty,
    readProperty,
    readStringProperty,
} from '../download.ts';
import {
    UNRECOGNIZED,
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

export function verifyAuditSignatures(
    report: unknown,
    expected: ExpectedProvenance,
): string[] {
    const label = `${expected.packageName}@${expected.packageVersion}`;
    if (typeof report !== 'object' || report === null) {
        return [`${UNRECOGNIZED}: npm audit signatures output was not an object.`];
    }
    const failures: string[] = [];
    failures.push(...unverifiedFailures(report, 'invalid'));
    failures.push(...unverifiedFailures(report, 'missing'));
    const verified = readArrayProperty(report, 'verified');
    if (verified === null) {
        failures.push(`${UNRECOGNIZED}: npm audit signatures reported no verified list.`);
        return failures;
    }
    const entry = verified.find(
        (value) => readStringProperty(value, 'name') === expected.packageName
            && readStringProperty(value, 'version') === expected.packageVersion,
    );
    if (entry === undefined) {
        failures.push(`npm did not verify the registry signature for ${label}.`);
        return failures;
    }
    const provenance = readProperty(readProperty(entry, 'attestations'), 'provenance');
    if (typeof provenance !== 'object' || provenance === null) {
        failures.push(`npm did not verify a provenance attestation for ${label}.`);
    }
    return failures;
}

function unverifiedFailures(report: unknown, key: string): string[] {
    const entries = readArrayProperty(report, key);
    if (entries === null || entries.length === 0) {
        return [];
    }
    return [`npm reported ${String(entries.length)} ${key} package signatures.`];
}
