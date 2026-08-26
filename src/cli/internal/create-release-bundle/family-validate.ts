import {
    validateFamilyReleaseRecord,
    type FamilyCandidateReceipt,
    type FamilyReleaseRecord,
} from '../../../candidate/receipt.ts';
import { sha256Hex, sha512Hex } from '../../../registry/integrity.ts';
import { errorMessage } from '../../support.ts';

export interface FamilyBundleBytes {
    receipt: Buffer;
    release: Buffer;
    notes: Buffer;
    tarballs: ReadonlyMap<string, Buffer>;
}

export function familyBundleFailures(
    bundled: FamilyBundleBytes,
    receipt: FamilyCandidateReceipt,
): string[] {
    const failures: string[] = [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(bundled.release.toString('utf8')) as unknown;
    } catch (error) {
        return ['release.json is not valid json: ' + errorMessage(error)];
    }
    failures.push(...validateFamilyReleaseRecord(parsed));
    if (bundled.notes.byteLength === 0) failures.push('RELEASE_NOTES.md must not be empty.');
    if (failures.length > 0) return failures;
    return consistencyFailures(parsed as FamilyReleaseRecord, receipt, bundled);
}

function consistencyFailures(
    release: FamilyReleaseRecord,
    receipt: FamilyCandidateReceipt,
    bundled: FamilyBundleBytes,
): string[] {
    const failures: string[] = [];
    match(release.candidateReceiptSha256, sha256Hex(bundled.receipt),
        'release.json candidateReceiptSha256', failures);
    match(release.releaseNotesSha256, sha256Hex(bundled.notes),
        'release.json releaseNotesSha256', failures);
    match(release.family.name, receipt.family.name, 'family.name', failures);
    match(release.family.version, receipt.family.version, 'family.version', failures);
    match(release.family.distTag, receipt.family.distTag, 'family.distTag', failures);
    match(release.source.repository, receipt.repository.name, 'source.repository', failures);
    match(release.source.tag, receipt.source.tag, 'source.tag', failures);
    match(release.source.commit, receipt.source.commit, 'source.commit', failures);
    if (release.packages.length !== receipt.packages.length) {
        failures.push('release.json and candidate.json package counts must match.');
        return failures;
    }
    for (const [index, member] of receipt.packages.entries()) {
        const published = release.packages[index];
        const bytes = bundled.tarballs.get(member.tarball.filename);
        if (published === undefined || bytes === undefined) {
            failures.push('bundle is missing package index ' + String(index) + '.');
            continue;
        }
        const label = member.name + '@' + member.version;
        match(published.name, member.name, label + ' name', failures);
        match(published.version, member.version, label + ' version', failures);
        match(published.distTag, member.distTag, label + ' distTag', failures);
        const sha256 = sha256Hex(bytes);
        const sha512 = sha512Hex(bytes);
        match(member.tarball.sha256, sha256, label + ' candidate receipt SHA-256', failures);
        match(member.tarball.sha512, sha512, label + ' candidate receipt SHA-512', failures);
        match(published.candidate.sha256, sha256, label + ' release candidate SHA-256', failures);
        match(published.candidate.sha512, sha512, label + ' release candidate SHA-512', failures);
        match(published.registry.sha256, sha256, label + ' registry SHA-256', failures);
        match(published.registry.sha512, sha512, label + ' registry SHA-512', failures);
    }
    return failures;
}

function match(
    declared: string,
    actual: string,
    label: string,
    failures: string[],
): void {
    if (declared !== actual) {
        failures.push(label + ' ' + declared + ' does not match bundled value ' + actual + '.');
    }
}
