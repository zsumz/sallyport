import { hashTarball } from '../../../candidate/inspect.ts';
import {
    validateCandidateReceipt,
    type CandidateReceipt,
} from '../../../candidate/receipt.ts';
import { failure } from '../../support.ts';

export function parseReceipt(bytes: Uint8Array): CandidateReceipt {
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    } catch {
        throw failure('Candidate retrieval failed:', ['candidate.json is not valid json.']);
    }
    const failures = validateCandidateReceipt(parsed);
    if (failures.length > 0) {
        throw failure('Candidate retrieval failed:', failures);
    }
    return parsed as CandidateReceipt;
}

export function tarballFailures(tarball: Uint8Array, receipt: CandidateReceipt): string[] {
    const digest = hashTarball(Buffer.from(tarball));
    const failures: string[] = [];
    if (digest.bytes !== receipt.tarball.bytes) {
        failures.push(
            `artifact tarball is ${String(digest.bytes)} bytes, the receipt records ${String(receipt.tarball.bytes)}.`,
        );
    }
    if (digest.sha256 !== receipt.tarball.sha256) {
        failures.push(
            `artifact tarball sha256 ${digest.sha256} does not match the receipt ${receipt.tarball.sha256}.`,
        );
    }
    if (digest.sha512 !== receipt.tarball.sha512) {
        failures.push(
            `artifact tarball sha512 ${digest.sha512} does not match the receipt ${receipt.tarball.sha512}.`,
        );
    }
    if (digest.integrity !== receipt.tarball.integrity) {
        failures.push(
            `artifact tarball integrity ${digest.integrity} does not match the receipt ${receipt.tarball.integrity}.`,
        );
    }
    return failures;
}
