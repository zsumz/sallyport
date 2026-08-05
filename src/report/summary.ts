import { appendFile } from 'node:fs/promises';

// Workflow outputs and summaries degrade to stdout outside GitHub Actions.
export async function writeWorkflowOutput(
    values: Readonly<Record<string, string>>,
): Promise<void> {
    const lines = Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join('');
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (githubOutput === undefined) {
        process.stdout.write(lines);
        return;
    }
    await appendFile(githubOutput, lines);
}

export async function writeWorkflowSummary(markdown: string): Promise<void> {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    const content = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
    if (summaryFile === undefined) {
        process.stdout.write(content);
        return;
    }
    await appendFile(summaryFile, content);
}
