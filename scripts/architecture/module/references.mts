import path from 'node:path';
import ts from 'typescript';

export interface ModuleReference {
    specifier: string;
    runtime: boolean;
    line: number;
    column: number;
}

export function moduleReferences(sourceFile: ts.SourceFile): ModuleReference[] {
    const references: ModuleReference[] = [];
    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            references.push(reference(
                sourceFile,
                statement.moduleSpecifier,
                !isTypeOnlyImport(statement),
            ));
        }
        if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined
            && ts.isStringLiteral(statement.moduleSpecifier)) {
            references.push(reference(sourceFile, statement.moduleSpecifier, !statement.isTypeOnly));
        }
    }
    return references;
}

export function resolveSourceReference(
    source: string,
    specifier: string,
    sourceFiles: ReadonlySet<string>,
): string | null {
    if (!specifier.startsWith('.')) {
        return null;
    }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier));
    const candidates = [
        target,
        target.replace(/\.js$/u, '.ts'),
        `${target}.ts`,
        `${target}/index.ts`,
    ];
    return candidates.find((candidate) => sourceFiles.has(candidate)) ?? null;
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
    const clause = node.importClause;
    const typeOnly = clause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
    if (clause === undefined || clause.name !== undefined || typeOnly) {
        return typeOnly;
    }
    const bindings = clause.namedBindings;
    return bindings !== undefined
        && ts.isNamedImports(bindings)
        && bindings.elements.length > 0
        && bindings.elements.every((element) => element.isTypeOnly);
}

function reference(
    sourceFile: ts.SourceFile,
    literal: ts.StringLiteral,
    runtime: boolean,
): ModuleReference {
    const start = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile));
    return {
        specifier: literal.text,
        runtime,
        line: start.line + 1,
        column: start.character + 1,
    };
}
