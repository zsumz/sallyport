import path from 'node:path';

export const sourceModuleLineLimit = 150;

const forbiddenModuleNames = new Set([
    'common.mts',
    'common.ts',
    'config.mts',
    'config.ts',
    'helpers.mts',
    'helpers.ts',
    'utils.mts',
    'utils.ts',
]);

export function inspectModuleLayout(relative: string, lineCount: number): string[] {
    const failures: string[] = [];
    if (forbiddenModuleNames.has(path.posix.basename(relative))) {
        failures.push(`${relative}: generic junk-drawer module names are forbidden.`);
    }
    if (relative.startsWith('src/') && lineCount > sourceModuleLineLimit) {
        failures.push(
            `${relative}: ${String(lineCount)} lines exceeds the `
            + `${String(sourceModuleLineLimit)}-line source-module limit.`,
        );
    }
    if (relative.startsWith('src/') && path.posix.basename(relative) === 'index.ts') {
        failures.push(`${relative}: source entrypoints must be named deliberately.`);
    }
    return failures;
}

export function countLines(source: string): number {
    return source === ''
        ? 0
        : source.split(/\r?\n/u).length - (source.endsWith('\n') ? 1 : 0);
}
