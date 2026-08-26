import { hashTarball } from '../../../candidate/inspect.ts';
import {
    isFamilyCandidateReceipt,
    validateCandidateReceipt,
    validateFamilyCandidateReceipt,
    type FamilyCandidatePackage,
    type ReleaseCandidateReceipt,
} from '../../../candidate/receipt.ts';
import { failure } from '../../support.ts';

export function parseReceipt(bytes: Uint8Array): ReleaseCandidateReceipt {
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    } catch {
        throw failure('Candidate retrieval failed:', ['candidate.json is not valid json.']);
    }
    const failures = isFamilyCandidateReceipt(parsed)
        ? validateFamilyCandidateReceipt(parsed)
        : validateCandidateReceipt(parsed);
    if (failures.length > 0) {
        throw failure('Candidate retrieval failed:', failures);
    }
    return parsed as ReleaseCandidateReceipt;
}

export function tarballFailures(
    input: Uint8Array | ReadonlyMap<string, Uint8Array>,
    receipt: ReleaseCandidateReceipt,
): string[] {
    const tarballs = input instanceof Uint8Array
        ? new Map([['package.tgz', input]])
        : input;
    if (!isFamilyCandidateReceipt(receipt)) {
        return digestFailures(tarballs.get('package.tgz'), receipt.tarball, 'artifact tarball');
    }
    const expected = new Set(receipt.packages.map((member) => member.tarball.filename));
    const failures: string[] = [];
    for (const name of tarballs.keys()) {
        if (!expected.has(name)) failures.push('artifact contains unexpected tarball ' + name + '.');
    }
    for (const member of receipt.packages) {
        failures.push(...digestFailures(
            tarballs.get(member.tarball.filename),
            member.tarball,
            member.tarball.filename,
        ));
    }
    return failures;
}

function digestFailures(
    bytes: Uint8Array | undefined,
    expected: FamilyCandidatePackage['tarball'],
    filename: string,
): string[] {
    if (bytes === undefined) return ['artifact is missing ' + filename + '.'];
    const digest = hashTarball(Buffer.from(bytes));
    const failures: string[] = [];
    if (digest.bytes !== expected.bytes) {
        failures.push(
            filename + ' is ' + String(digest.bytes)
            + ' bytes, the receipt records ' + String(expected.bytes) + '.',
        );
    }
    if (digest.sha256 !== expected.sha256) {
        failures.push(filename + ' sha256 ' + digest.sha256
            + ' does not match the receipt ' + expected.sha256 + '.');
    }
    if (digest.sha512 !== expected.sha512) {
        failures.push(filename + ' sha512 ' + digest.sha512
            + ' does not match the receipt ' + expected.sha512 + '.');
    }
    if (digest.integrity !== expected.integrity) {
        failures.push(filename + ' integrity ' + digest.integrity
            + ' does not match the receipt ' + expected.integrity + '.');
    }
    return failures;
}
