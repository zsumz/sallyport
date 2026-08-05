import type { Profile } from '../template.ts';

export interface RemoteTarget {
    dir: string;
    repository: string;
    packageName: string;
    profile: Profile;
    defaultBranch: string;
    requiredStatusChecks: readonly string[] | null | undefined;
}
