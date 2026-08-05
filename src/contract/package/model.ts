export interface PackageMetadata {
    name: string | undefined;
    version: string | undefined;
    isPrivate: boolean;
    hasWorkspaces: boolean;
    publishAccess: string | undefined;
    publishProvenance: boolean | undefined;
    repositoryUrl: string | undefined;
    hasLockfile: boolean;
    lockName: string | undefined;
    lockVersion: string | undefined;
    lockRootName: string | undefined;
    lockRootVersion: string | undefined;
}

export interface PackageContractInput extends PackageMetadata {
    tag: string;
    expectedRepository: string;
    registryHasVersion: boolean;
    hasReleaseNotes: boolean;
}
