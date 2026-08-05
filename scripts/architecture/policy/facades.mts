import path from 'node:path';
import ts from 'typescript';

export function sourceFacades(sourceFiles: readonly string[]): ReadonlyMap<string, string> {
    const facades: Map<string, string> = new Map();
    for (const file of sourceFiles) {
        if (!file.endsWith('.ts')) {
            continue;
        }
        const directory = file.slice(0, -'.ts'.length);
        if (sourceFiles.some((candidate) => candidate.startsWith(`${directory}/`))) {
            facades.set(directory, file);
        }
    }
    return facades;
}

export function isPureReExportFacade(sourceFile: ts.SourceFile): boolean {
    return sourceFile.statements.every((statement) => ts.isExportDeclaration(statement));
}

export function facadeImportFailure(
    source: string,
    target: string,
    facades: ReadonlyMap<string, string>,
): string | undefined {
    for (const [directory, facade] of facades) {
        if (!target.startsWith(`${directory}/`)) {
            continue;
        }
        if (source === facade) {
            return undefined;
        }
        const sourceDirectory = path.posix.dirname(source);
        if (sourceDirectory === directory || source.startsWith(`${directory}/`)) {
            return undefined;
        }
        return `${source} must import ${facade}, not implementation module ${target}.`;
    }
    return undefined;
}
