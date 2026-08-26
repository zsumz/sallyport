export interface PackageMetadata {
    name: string | undefined;
    version: string | undefined;
    isPrivate: boolean;
    hasWorkspaces: boolean;
    publishAccess: string | undefined;
    publishProvenance: boolean | undefined;
    repositoryUrl: string | undefined;
    requiredStatusChecks: readonly string[] | null | undefined;
    hasLockfile: boolean;
    lockName: string | undefined;
    lockVersion: string | undefined;
    lockRootName: string | undefined;
    lockRootVersion: string | undefined;
}

export interface ReleasePackageMetadata extends PackageMetadata {
    directory: string;
    repositoryDirectory: string | undefined;
}

export interface ReleaseMetadata {
    root: PackageMetadata;
    packages: readonly ReleasePackageMetadata[];
    isFamily: boolean;
    configurationFailures: readonly string[];
}

export interface ReleaseContractInput {
    metadata: ReleaseMetadata;
    tag: string;
    expectedRepository: string;
    registryVersions: ReadonlySet<string>;
    hasReleaseNotes: boolean;
}

export interface PackageContractInput extends PackageMetadata {
    tag: string;
    expectedRepository: string;
    registryHasVersion: boolean;
    hasReleaseNotes: boolean;
}
