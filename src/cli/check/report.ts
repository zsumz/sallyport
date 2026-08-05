import { CHECK_LABELS, type CheckReport } from './model.ts';

export function checkLabel(id: string): string {
    return CHECK_LABELS.find((entry) => entry[0] === id)?.[1] ?? id;
}

export function formatCheckReport(report: CheckReport): string {
    const lines: string[] = [];
    for (const check of report.checks) {
        lines.push(`${check.status.toUpperCase()} ${checkLabel(check.id)}`);
        if (check.status !== 'pass') {
            lines.push(`     ${check.message}`);
        }
    }
    return `${lines.join('\n')}\n`;
}
