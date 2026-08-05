import type { CommandRunner } from '../../contract/signing.ts';
import { runCommand } from '../../report/exec.ts';
import { writeWorkflowOutput, writeWorkflowSummary } from '../../report/summary.ts';
import { createRegistryFetch, type RegistryFetch } from '../../registry/download.ts';

// Every internal command receives its effects instead of reaching for globals,
// so unit tests drive them with plain objects and no network.
export interface CliEffects {
    exec: CommandRunner;
    registry: RegistryFetch;
    cwd: string;
    env: Readonly<Record<string, string | undefined>>;
    sleep: (milliseconds: number) => Promise<void>;
    writeOutput: (values: Readonly<Record<string, string>>) => Promise<void>;
    writeSummary: (markdown: string) => Promise<void>;
    log: (line: string) => void;
}

export function defaultEffects(): CliEffects {
    return {
        exec: runCommand,
        registry: createRegistryFetch(),
        cwd: process.cwd(),
        env: process.env,
        sleep: async (milliseconds) => {
            await new Promise<void>((resolve) => {
                setTimeout(resolve, milliseconds);
            });
        },
        writeOutput: writeWorkflowOutput,
        writeSummary: writeWorkflowSummary,
        log: (line) => {
            process.stdout.write(`${line}\n`);
        },
    };
}
