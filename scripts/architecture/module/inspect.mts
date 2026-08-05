import { readFile } from 'node:fs/promises';
import ts from 'typescript';

import { facadeImportFailure, isPureReExportFacade } from '../policy/facades.mts';
import { inspectModuleLayout, countLines } from '../policy/layout.mts';
import { layerImportFailure } from '../policy/layers.mts';
import { moduleReferences, resolveSourceReference } from './references.mts';

export interface ModuleInspection {
    failures: string[];
    runtimeDependencies: string[];
}

export async function inspectModule(
    root: string,
    file: string,
    relative: string,
    sourceFiles: ReadonlySet<string>,
    facades: ReadonlyMap<string, string>,
): Promise<ModuleInspection> {
    const source = await readFile(file, 'utf8');
    const failures = inspectModuleLayout(relative, countLines(source));
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    if (facades.has(relative) && !isPureReExportFacade(sourceFile)) {
        failures.push(`${relative}: facade modules must contain only re-exports.`);
    }
    const runtimeDependencies: string[] = [];
    for (const reference of moduleReferences(sourceFile)) {
        const target = resolveSourceReference(relative, reference.specifier, sourceFiles);
        if (target === null) {
            if (reference.specifier.startsWith('.') && relative.startsWith('src/')) {
                failures.push(
                    `${relative}:${String(reference.line)}:${String(reference.column)} `
                    + `cannot resolve ${reference.specifier}.`,
                );
            }
            continue;
        }
        const facadeFailure = facadeImportFailure(relative, target, facades);
        if (facadeFailure !== undefined) {
            failures.push(`${relative}:${String(reference.line)}: ${facadeFailure}`);
        }
        if (relative.startsWith('src/')) {
            const layerFailure = layerImportFailure(relative, target);
            if (layerFailure !== undefined) {
                failures.push(`${relative}:${String(reference.line)}: ${layerFailure}`);
            }
        }
        if (reference.runtime && relative.startsWith('src/')) {
            runtimeDependencies.push(target);
        }
    }
    return { failures, runtimeDependencies };
}
