#!/usr/bin/env node
import { runCli } from './dispatch.ts';
import { errorMessage } from './support.ts';

// Workflow steps read annotations, humans read stderr; both always get every
// failure line.
function reportFailure(error: unknown): void {
    const annotate = process.env.GITHUB_ACTIONS === 'true';
    const lines = errorMessage(error)
        .split('\n')
        .filter((line) => line.trim() !== '');
    for (const line of lines.length === 0 ? ['quoin failed.'] : lines) {
        if (annotate) {
            process.stdout.write(`::error::${line}\n`);
        }
        process.stderr.write(`${line}\n`);
    }
}

try {
    process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
    reportFailure(error);
    process.exitCode = 1;
}
