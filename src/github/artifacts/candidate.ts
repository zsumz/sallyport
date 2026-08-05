import { downloadArtifactZip, listRunArtifacts, selectCandidateArtifact } from './api.ts';
import {
    CANDIDATE_RECEIPT_NAME,
    CANDIDATE_TARBALL_NAME,
    type CandidateArtifactFiles,
    type CandidateArtifactInput,
} from './model.ts';
import { readZipEntries } from './zip.ts';

export async function fetchCandidateArtifact(
    input: CandidateArtifactInput,
): Promise<CandidateArtifactFiles> {
    const artifacts = await listRunArtifacts(input.fetchJson, input.target, input.runId);
    const artifact = selectCandidateArtifact(artifacts, input.commit, input.runAttempt);
    const zip = await downloadArtifactZip(input.fetchBuffer, input.target, artifact);
    return extractCandidateArtifact(zip);
}

// The candidate artifact contains exactly package.tgz and candidate.json.
export function extractCandidateArtifact(zip: Uint8Array): CandidateArtifactFiles {
    const entries = readZipEntries(zip);
    const names = entries.map((entry) => entry.name);
    const unexpected = names.filter(
        (name) => name !== CANDIDATE_TARBALL_NAME && name !== CANDIDATE_RECEIPT_NAME,
    );
    if (unexpected.length > 0) {
        throw new Error(
            `Candidate artifact contains unexpected entries: ${unexpected.join(', ')}.`,
        );
    }
    const tarball = entries.find((entry) => entry.name === CANDIDATE_TARBALL_NAME);
    const receipt = entries.find((entry) => entry.name === CANDIDATE_RECEIPT_NAME);
    if (tarball === undefined || receipt === undefined) {
        throw new Error(
            `Candidate artifact must contain ${CANDIDATE_TARBALL_NAME} and ${CANDIDATE_RECEIPT_NAME}.`,
        );
    }
    if (names.length !== 2) {
        throw new Error('Candidate artifact contains duplicate entries.');
    }
    return { tarball: tarball.data, receipt: receipt.data };
}
