import { hashTarball } from '../../src/candidate/inspect.ts';
import type { CandidateReceipt, ReleaseRecord } from '../../src/candidate/receipt.ts';

const CANDIDATE = hashTarball(Buffer.from('quoin candidate tarball', 'utf8'));
const RECEIPT = hashTarball(Buffer.from('quoin candidate receipt', 'utf8'));

export function validCandidateReceipt(): CandidateReceipt {
    return {
        schema: 1,
        protocol: 'quoin/0.1',
        quoin: {
            version: '0.1.0',
            workflow: 'zsumz/quoin/.github/workflows/stage.yml',
            sha: '0123456789abcdef0123456789abcdef01234567',
        },
        repository: {
            name: 'zsumz/smoque',
            id: 1286348597,
            defaultBranch: 'main',
        },
        source: {
            tag: 'v0.1.2',
            commit: 'fedcba9876543210fedcba9876543210fedcba98',
            signed: true,
            signerFingerprint: 'B58439871CD2A7275B20CC19EC8E4D26598A0373',
        },
        package: {
            name: 'smoque',
            version: '0.1.2',
            access: 'public',
            distTag: 'latest',
        },
        tarball: {
            filename: 'package.tgz',
            bytes: CANDIDATE.bytes,
            sha256: CANDIDATE.sha256,
            sha512: CANDIDATE.sha512,
            integrity: CANDIDATE.integrity,
        },
        run: {
            id: 123456789,
            attempt: 1,
        },
    };
}

export function unsignedPrereleaseReceipt(): CandidateReceipt {
    const receipt = validCandidateReceipt();
    return {
        ...receipt,
        repository: { ...receipt.repository, name: 'zsumz/quoin', defaultBranch: 'main' },
        source: {
            ...receipt.source,
            tag: 'v2.0.0-alpha.10',
            signed: false,
            signerFingerprint: null,
        },
        package: {
            ...receipt.package,
            name: '@zsumz/quoin-fixture',
            version: '2.0.0-alpha.10',
            distTag: 'alpha',
        },
    };
}

export function validReleaseRecord(): ReleaseRecord {
    return {
        schema: 1,
        protocol: 'quoin/0.1',
        candidateReceiptSha256: RECEIPT.sha256,
        package: {
            name: 'smoque',
            version: '0.1.2',
            distTag: 'latest',
        },
        candidate: {
            sha256: CANDIDATE.sha256,
            sha512: CANDIDATE.sha512,
        },
        registry: {
            sha256: CANDIDATE.sha256,
            sha512: CANDIDATE.sha512,
            integrityVerified: true,
            signatureVerified: true,
            provenanceVerified: true,
        },
        source: {
            repository: 'zsumz/smoque',
            tag: 'v0.1.2',
            commit: 'fedcba9876543210fedcba9876543210fedcba98',
        },
    };
}
