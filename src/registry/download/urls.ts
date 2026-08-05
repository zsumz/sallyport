export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

export function packumentUrl(registry: string, packageName: string): string {
    return `${registryRoot(registry)}/${encodePackageName(packageName)}`;
}

export function distTagsUrl(registry: string, packageName: string): string {
    return `${registryRoot(registry)}/-/package/${encodePackageName(packageName)}/dist-tags`;
}

export function attestationsUrl(
    registry: string,
    packageName: string,
    version: string,
): string {
    return `${registryRoot(registry)}/-/npm/v1/attestations/${encodePackageName(packageName)}@${version}`;
}

export function encodePackageName(packageName: string): string {
    return packageName.replace('/', '%2F');
}

function registryRoot(registry: string): string {
    return registry.endsWith('/') ? registry.slice(0, -1) : registry;
}
