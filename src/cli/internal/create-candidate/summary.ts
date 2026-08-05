import type { CandidateReceipt } from '../../../candidate/receipt.ts';
import type { Profile } from '../../template.ts';

export function receiptSummary(receipt: CandidateReceipt, profile: Profile): string {
    return [
        '### quoin release candidate',
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| Package | \`${receipt.package.name}@${receipt.package.version}\` |`,
        `| Dist-tag | \`${receipt.package.distTag}\` |`,
        `| Access | \`${receipt.package.access}\` |`,
        `| Tag | \`${receipt.source.tag}\` |`,
        `| Commit | \`${receipt.source.commit}\` |`,
        `| Repository | \`${receipt.repository.name}\` (${String(receipt.repository.id)}) |`,
        `| Default branch | \`${receipt.repository.defaultBranch}\` |`,
        `| Profile | \`${profile}\` |`,
        `| Signer | \`${receipt.source.signerFingerprint ?? 'unsigned'}\` |`,
        `| Candidate SHA-256 | \`${receipt.tarball.sha256}\` |`,
        `| Candidate bytes | ${String(receipt.tarball.bytes)} |`,
        `| Integrity | \`${receipt.tarball.integrity}\` |`,
        `| quoin | \`${receipt.quoin.version}\` @ \`${receipt.quoin.sha}\` |`,
        `| Candidate run | ${String(receipt.run.id)} (attempt ${String(receipt.run.attempt)}) |`,
        '',
    ].join('\n');
}
