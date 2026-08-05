import { describe, expect, it } from 'vitest';

import { findDependencyCycles } from '../../scripts/architecture/dependency/cycles.mts';

describe('findDependencyCycles', () => {
    it('reports each runtime cycle once in canonical order', () => {
        const graph: Map<string, readonly string[]> = new Map([
            ['src/b.ts', ['src/a.ts']],
            ['src/a.ts', ['src/b.ts']],
            ['src/leaf.ts', []],
        ]);

        expect(findDependencyCycles(graph)).toEqual([
            ['src/a.ts', 'src/b.ts', 'src/a.ts'],
        ]);
    });

    it('accepts an acyclic dependency graph', () => {
        const graph: Map<string, readonly string[]> = new Map([
            ['src/a.ts', ['src/b.ts']],
            ['src/b.ts', []],
        ]);

        expect(findDependencyCycles(graph)).toEqual([]);
    });
});
