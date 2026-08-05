const allowedImports: Readonly<Record<string, ReadonlySet<string>>> = {
    report: new Set(['report']),
    contract: new Set(['contract', 'report']),
    candidate: new Set(['candidate', 'report']),
    registry: new Set(['registry', 'candidate', 'report']),
    github: new Set(['github', 'candidate', 'contract', 'registry', 'report']),
    cli: new Set(['cli', 'candidate', 'contract', 'github', 'registry', 'report']),
};

export function layerImportFailure(source: string, target: string): string | undefined {
    const sourceLayer = source.split('/')[1];
    const targetLayer = target.split('/')[1];
    if (sourceLayer === undefined || targetLayer === undefined) {
        return undefined;
    }
    const allowed = allowedImports[sourceLayer];
    if (allowed === undefined) {
        return `source layer "${sourceLayer}" has no declared import policy.`;
    }
    if (!allowed.has(targetLayer)) {
        return `${sourceLayer} modules must not import the ${targetLayer} layer.`;
    }
    return undefined;
}
