import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { findDependencyCycles } from './dependency/cycles.mts';
import { collectModuleFiles, relativePath } from './module/files.mts';
import { inspectModule } from './module/inspect.mts';
import { sourceFacades } from './policy/facades.mts';

const root = path.resolve(import.meta.dirname, '../..');
const inspectedRoots = [
    path.join(root, 'src'),
    path.join(root, 'scripts'),
    path.join(root, 'test'),
];
const files = (await Promise.all(inspectedRoots.map(collectModuleFiles))).flat();
const relativeFiles = files.map((file) => relativePath(root, file));
const sourceFiles = new Set(relativeFiles.filter((file) => file.startsWith('src/')));
const facades = sourceFacades([...sourceFiles]);
const failures: string[] = [];
const graph: Map<string, readonly string[]> = new Map();

const packageJson: unknown = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (hasRuntimeDependencies(packageJson)) {
    failures.push('package.json: runtime dependencies require an accepted design decision.');
}

for (const [index, file] of files.entries()) {
    const relative = relativeFiles[index];
    if (relative === undefined) {
        continue;
    }
    const inspection = await inspectModule(root, file, relative, sourceFiles, facades);
    failures.push(...inspection.failures);
    if (relative.startsWith('src/')) {
        graph.set(relative, inspection.runtimeDependencies);
    }
}

for (const cycle of findDependencyCycles(graph)) {
    failures.push(`src: circular runtime dependency ${cycle.join(' -> ')}`);
}

if (failures.length > 0) {
    console.error('Architecture guardrails failed:\n');
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exitCode = 1;
} else {
    console.log(
        `Architecture guardrails passed for ${String(sourceFiles.size)} source modules `
        + `and ${String(facades.size)} facades.`,
    );
}

function hasRuntimeDependencies(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || !('dependencies' in value)) {
        return false;
    }
    const dependencies = value.dependencies;
    return typeof dependencies === 'object'
        && dependencies !== null
        && Object.keys(dependencies).length > 0;
}
