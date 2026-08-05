const GITHUB_URL_PATTERN =
    /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?(?:www\.)?github\.com\/(.+)$/u;
const GITHUB_SCP_PATTERN = /^(?:[^@/]+@)?github\.com:(.+)$/u;
const GITHUB_SHORTHAND_PATTERN = /^github:(.+)$/u;
const REPOSITORY_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;
const BARE_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;

export function normalizeRepositoryUrl(url: string): string | null {
    const source = url.trim().replace(/^git\+/u, '');
    const withoutQuery = source.split('#')[0]?.split('?')[0] ?? '';
    const repositoryPath = githubPath(withoutQuery);
    if (repositoryPath === null) {
        return null;
    }
    const segments = repositoryPath
        .replace(/\/+$/u, '')
        .replace(/\.git$/u, '')
        .replace(/\/+$/u, '')
        .split('/');
    if (segments.length !== 2) {
        return null;
    }
    const [owner, name] = segments;
    if (
        owner === undefined
        || name === undefined
        || !REPOSITORY_SEGMENT_PATTERN.test(owner)
        || !REPOSITORY_SEGMENT_PATTERN.test(name)
        || isRelativeSegment(owner)
        || isRelativeSegment(name)
    ) {
        return null;
    }
    return `${owner}/${name}`;
}

function githubPath(value: string): string | null {
    const url = GITHUB_URL_PATTERN.exec(value);
    if (url !== null) {
        return url[1] ?? null;
    }
    const scp = GITHUB_SCP_PATTERN.exec(value);
    if (scp !== null) {
        return scp[1] ?? null;
    }
    const shorthand = GITHUB_SHORTHAND_PATTERN.exec(value);
    if (shorthand !== null) {
        return shorthand[1] ?? null;
    }
    return BARE_REPOSITORY_PATTERN.test(value) ? value : null;
}

function isRelativeSegment(segment: string): boolean {
    return segment === '.' || segment === '..';
}
