export function findDependencyCycles(
    graph: ReadonlyMap<string, readonly string[]>,
): readonly string[][] {
    const complete: Set<string> = new Set();
    const active: Map<string, number> = new Map();
    const stack: string[] = [];
    const cycles: Map<string, string[]> = new Map();

    function visit(module: string): void {
        const cycleStart = active.get(module);
        if (cycleStart !== undefined) {
            const cycle = canonicalCycle([...stack.slice(cycleStart), module]);
            cycles.set(cycle.join('\0'), cycle);
            return;
        }
        if (complete.has(module)) {
            return;
        }
        active.set(module, stack.length);
        stack.push(module);
        for (const dependency of graph.get(module) ?? []) {
            visit(dependency);
        }
        stack.pop();
        active.delete(module);
        complete.add(module);
    }

    for (const module of [...graph.keys()].sort()) {
        visit(module);
    }
    return [...cycles.values()].sort((left, right) => left.join().localeCompare(right.join()));
}

function canonicalCycle(cycle: readonly string[]): string[] {
    const nodes = cycle.slice(0, -1);
    const rotations = nodes.map((_, index) => [...nodes.slice(index), ...nodes.slice(0, index)]);
    const smallest = rotations.sort((left, right) => left.join().localeCompare(right.join()))[0] ?? [];
    return [...smallest, smallest[0] ?? ''];
}
