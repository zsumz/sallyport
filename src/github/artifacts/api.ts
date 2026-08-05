import {
    readArrayProperty,
    readBooleanProperty,
    readNumberProperty,
    readStringProperty,
    type FetchBuffer,
    type FetchJson,
    type FetchRequest,
} from '../../registry/download.ts';
import {
    GITHUB_API_VERSION,
    type GithubApiTarget,
    type RunArtifact,
} from './model.ts';

export function candidateArtifactName(commit: string): string {
    return `sallyport-candidate-${commit}`;
}

export function githubHeaders(token: string): Record<string, string> {
    return {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': GITHUB_API_VERSION,
    };
}

export function githubRequest(token: string, method: string): FetchRequest {
    return {
        method,
        headers: githubHeaders(token),
        body: null,
    };
}

export async function listRunArtifacts(
    fetchJson: FetchJson,
    target: GithubApiTarget,
    runId: number,
): Promise<RunArtifact[]> {
    const url = `${apiRoot(target.apiBase)}/repos/${target.repository}/actions/runs/${String(runId)}/artifacts?per_page=100`;
    const response = await fetchJson(url, githubRequest(target.token, 'GET'));
    if (response.status !== 200) {
        throw new Error(`GitHub request failed: ${url} returned ${String(response.status)}.`);
    }
    const entries = readArrayProperty(response.body, 'artifacts');
    if (entries === null) {
        throw new Error(`GitHub request failed: ${url} returned no artifact list.`);
    }
    return entries.map((entry) => readArtifact(entry));
}

export function selectCandidateArtifact(
    artifacts: readonly RunArtifact[],
    commit: string,
): RunArtifact {
    const name = candidateArtifactName(commit);
    const matches = artifacts.filter((artifact) => artifact.name === name);
    const artifact = matches[0];
    if (artifact === undefined) {
        throw new Error(`Candidate retrieval failed: artifact ${name} is not present on the run.`);
    }
    if (matches.length > 1) {
        throw new Error(`Candidate retrieval failed: artifact ${name} is present ${String(matches.length)} times.`);
    }
    if (artifact.expired) {
        throw new Error(`Candidate retrieval failed: artifact ${name} has expired.`);
    }
    return artifact;
}

export async function downloadArtifactZip(
    fetchBuffer: FetchBuffer,
    target: GithubApiTarget,
    artifact: RunArtifact,
): Promise<Uint8Array> {
    const expected = origin(apiRoot(target.apiBase));
    const actual = origin(artifact.archiveDownloadUrl);
    if (actual === null || actual !== expected) {
        throw new Error(
            `Candidate retrieval failed: artifact download URL ${artifact.archiveDownloadUrl} is not served by ${target.apiBase}.`,
        );
    }
    const response = await fetchBuffer(
        artifact.archiveDownloadUrl,
        githubRequest(target.token, 'GET'),
    );
    if (response.status !== 200) {
        throw new Error(
            `GitHub request failed: ${artifact.archiveDownloadUrl} returned ${String(response.status)}.`,
        );
    }
    return response.body;
}

function readArtifact(entry: unknown): RunArtifact {
    const id = readNumberProperty(entry, 'id');
    const name = readStringProperty(entry, 'name');
    const url = readStringProperty(entry, 'archive_download_url');
    if (id === null || name === null || url === null) {
        throw new Error('GitHub returned an unreadable workflow run artifact.');
    }
    return {
        id,
        name,
        expired: readBooleanProperty(entry, 'expired') ?? false,
        sizeInBytes: readNumberProperty(entry, 'size_in_bytes') ?? 0,
        archiveDownloadUrl: url,
    };
}

function apiRoot(apiBase: string): string {
    return apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
}

function origin(value: string): string | null {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}
