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

const FAMILY_TARBALL = /^package(?:-[1-9][0-9]*)?\.tgz$/u;

export function extractCandidateArtifact(zip: Uint8Array): CandidateArtifactFiles {
    const entries = readZipEntries(zip);
    const names = entries.map((entry) => entry.name);
    const unexpected = names.filter(
        (name) => name !== CANDIDATE_RECEIPT_NAME && !FAMILY_TARBALL.test(name),
    );
    if (unexpected.length > 0) {
        throw new Error(
            'Candidate artifact contains unexpected entries: ' + unexpected.join(', ') + '.',
        );
    }
    if (new Set(names).size !== names.length) {
        throw new Error('Candidate artifact contains duplicate entries.');
    }
    const receipts = entries.filter((entry) => entry.name === CANDIDATE_RECEIPT_NAME);
    const packed = entries.filter((entry) => FAMILY_TARBALL.test(entry.name));
    if (receipts.length !== 1 || packed.length === 0) {
        throw new Error(
            'Candidate artifact must contain candidate.json and at least one package tarball.',
        );
    }
    const tarballs = new Map(packed.map((entry) => [entry.name, entry.data]));
    const legacy = tarballs.get(CANDIDATE_TARBALL_NAME) ?? packed[0]?.data;
    if (legacy === undefined) throw new Error('Candidate artifact contains no package tarball.');
    return { tarball: legacy, tarballs, receipt: receipts[0]?.data ?? new Uint8Array() };
}
