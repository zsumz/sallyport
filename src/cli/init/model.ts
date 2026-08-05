import { RELEASE_NOTES_DIRECTORY } from '../../contract/release.ts';
import type { CommandRunner } from '../../contract/signing.ts';

export interface InitOptions {
    dir: string;
    strict: boolean;
    upgrade: boolean;
    force: boolean;
    sha: string | undefined;
    exec: CommandRunner;
    log: (line: string) => void;
}

export const STRICT_DIRECTORIES = [RELEASE_NOTES_DIRECTORY, 'etc'] as const;
