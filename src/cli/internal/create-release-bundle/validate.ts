import {
    validateCandidateReceipt,
    validateReleaseRecord,
    type CandidateReceipt,
    type ReleaseRecord,
} from '../../../candidate/receipt.ts';
import {
    CANDIDATE_RECEIPT_NAME,
    CANDIDATE_TARBALL_NAME,
} from '../../../github/artifacts.ts';
import { sha256Hex, sha512Hex } from '../../../registry/integrity.ts';
import { errorMessage } from '../../support.ts';
import {
    RELEASE_NOTES_FILENAME,
    RELEASE_RECORD_FILENAME,
    type BundleBytes,
} from './model.ts';

export function bundleFailures(bundled: BundleBytes): string[] {
    const failures: string[] = [];
    const release = parseJson(bundled.release, RELEASE_RECORD_FILENAME, failures);
    const receipt = parseJson(bundled.receipt, CANDIDATE_RECEIPT_NAME, failures);
    if (release !== undefined) {
        failures.push(...validateReleaseRecord(release));
    }
    if (receipt !== undefined) {
        failures.push(...validateCandidateReceipt(receipt));
    }
    if (bundled.notes.byteLength === 0) {
        failures.push(`${RELEASE_NOTES_FILENAME} must not be empty.`);
    }
    if (failures.length > 0) {
        return failures;
    }
    return consistencyFailures(release as ReleaseRecord, receipt as CandidateReceipt, bundled);
}

function consistencyFailures(
    release: ReleaseRecord,
    receipt: CandidateReceipt,
    bundled: BundleBytes,
): string[] {
    const failures: string[] = [];
    const receiptDigest = sha256Hex(bundled.receipt);
    if (release.candidateReceiptSha256 !== receiptDigest) {
        failures.push(
            `${RELEASE_RECORD_FILENAME} candidateReceiptSha256 ${release.candidateReceiptSha256}`
            + ` does not match the bundled ${CANDIDATE_RECEIPT_NAME} ${receiptDigest}.`,
        );
    }
    const notesDigest = sha256Hex(bundled.notes);
    if (release.releaseNotesSha256 !== notesDigest) {
        failures.push(
            `${RELEASE_RECORD_FILENAME} releaseNotesSha256 ${release.releaseNotesSha256}`
            + ` does not match ${RELEASE_NOTES_FILENAME} ${notesDigest}.`,
        );
    }
    const sha256 = sha256Hex(bundled.tarball);
    const sha512 = sha512Hex(bundled.tarball);
    failures.push(...digestFailure('candidate.sha256', release.candidate.sha256, sha256));
    failures.push(...digestFailure('candidate.sha512', release.candidate.sha512, sha512));
    failures.push(...digestFailure('registry.sha256', release.registry.sha256, sha256));
    failures.push(...digestFailure('registry.sha512', release.registry.sha512, sha512));
    failures.push(...digestFailure('candidate.json tarball.sha256', receipt.tarball.sha256, sha256));
    failures.push(...digestFailure('candidate.json tarball.sha512', receipt.tarball.sha512, sha512));
    failures.push(...match('package.name', receipt.package.name, release.package.name));
    failures.push(...match('package.version', receipt.package.version, release.package.version));
    failures.push(...match('package.distTag', receipt.package.distTag, release.package.distTag));
    failures.push(...match('source.tag', receipt.source.tag, release.source.tag));
    failures.push(...match('source.commit', receipt.source.commit, release.source.commit));
    failures.push(...match('source.repository', receipt.repository.name, release.source.repository));
    return failures;
}

function digestFailure(label: string, declared: string, actual: string): string[] {
    return declared === actual
        ? []
        : [`${label} ${declared} does not match the bundled ${CANDIDATE_TARBALL_NAME} ${actual}.`];
}

function match(label: string, receiptValue: string, releaseValue: string): string[] {
    return receiptValue === releaseValue
        ? []
        : [`${CANDIDATE_RECEIPT_NAME} ${label} ${receiptValue} does not match ${RELEASE_RECORD_FILENAME} ${releaseValue}.`];
}

function parseJson(bytes: Buffer, name: string, failures: string[]): unknown {
    try {
        return JSON.parse(bytes.toString('utf8')) as unknown;
    } catch (error) {
        failures.push(`${name} is not valid json: ${errorMessage(error)}`);
        return undefined;
    }
}
