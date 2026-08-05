import type { SummaryInput } from './model.ts';

export function sourceSummary(input: SummaryInput): string {
    return [
        '### sallyport source inspection',
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| Package | \`${input.name}@${input.version}\` |`,
        `| Tag | \`${input.tag}\` |`,
        `| Dist-tag | \`${input.distTag}\` |`,
        `| Repository | \`${input.repository}\` (${String(input.repositoryId)}) |`,
        `| Profile | \`${input.profile}\` |`,
        `| Mode | \`${input.mode}\` |`,
        `| Signer | \`${input.fingerprint ?? 'unsigned'}\` |`,
        '',
    ].join('\n');
}
