import { describe, expect, it } from 'vitest';
import { hashTarball } from '../../../src/candidate/inspect.ts';
import {
    buildCandidateReceipt,
    buildReleaseRecord,
    CANDIDATE_TARBALL_FILENAME,
    PROTOCOL,
    RECEIPT_SCHEMA_VERSION,
    validateCandidateReceipt,
    validateReleaseRecord,
    type CandidateReceiptParts,
    type ReleaseRecordParts,
} from '../../../src/candidate/receipt.ts';

const DIGEST = hashTarball(Buffer.from('quoin candidate tarball', 'utf8'));
const RECEIPT_DIGEST = hashTarball(Buffer.from('quoin candidate receipt', 'utf8'));
const COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';

function candidateParts(): CandidateReceiptParts {
    return {
        quoin: {
            version: '0.1.0',
            workflow: 'zsumz/quoin/.github/workflows/stage.yml',
            sha: '0123456789abcdef0123456789abcdef01234567',
        },
        repository: { name: 'zsumz/smoque', id: 1286348597, defaultBranch: 'main' },
        source: {
            tag: 'v0.1.2',
            commit: COMMIT,
            signed: true,
            signerFingerprint: 'B58439871CD2A7275B20CC19EC8E4D26598A0373',
        },
        package: { name: 'smoque', version: '0.1.2', distTag: 'latest' },
        tarball: DIGEST,
        run: { id: 123456789, attempt: 1 },
    };
}

function releaseParts(): ReleaseRecordParts {
    return {
        candidateReceiptSha256: RECEIPT_DIGEST.sha256,
        package: { name: 'smoque', version: '0.1.2', distTag: 'latest' },
        candidate: { sha256: DIGEST.sha256, sha512: DIGEST.sha512 },
        registry: {
            sha256: DIGEST.sha256,
            sha512: DIGEST.sha512,
            integrityVerified: true,
            signatureVerified: true,
            provenanceVerified: true,
        },
        source: { repository: 'zsumz/smoque', tag: 'v0.1.2', commit: COMMIT },
    };
}

describe('buildCandidateReceipt', () => {
    it('derives the protocol constants, public access and fixed tarball name', () => {
        const receipt = buildCandidateReceipt(candidateParts());

        expect(receipt.schema).toBe(RECEIPT_SCHEMA_VERSION);
        expect(receipt.protocol).toBe(PROTOCOL);
        expect(receipt.package.access).toBe('public');
        expect(receipt.tarball.filename).toBe(CANDIDATE_TARBALL_FILENAME);
        expect(receipt.tarball.bytes).toBe(DIGEST.bytes);
    });

    it('serializes fields in the documented order', () => {
        const receipt = buildCandidateReceipt(candidateParts());

        expect(Object.keys(receipt)).toEqual([
            'schema',
            'protocol',
            'quoin',
            'repository',
            'source',
            'package',
            'tarball',
            'run',
        ]);
        expect(Object.keys(receipt.tarball)).toEqual([
            'filename',
            'bytes',
            'sha256',
            'sha512',
            'integrity',
        ]);
    });

    it('accepts an unsigned candidate', () => {
        const parts = candidateParts();
        const receipt = buildCandidateReceipt({
            ...parts,
            source: { ...parts.source, signed: false, signerFingerprint: null },
        });

        expect(receipt.source.signerFingerprint).toBeNull();
    });

    it('refuses to build a receipt with a malformed digest', () => {
        const parts = candidateParts();

        expect(() => buildCandidateReceipt({
            ...parts,
            tarball: { ...parts.tarball, sha256: 'nope' },
        })).toThrow(/Candidate receipt is invalid:[\s\S]*tarball\.sha256/u);
    });

    it('refuses to build a receipt whose tag does not match the version', () => {
        const parts = candidateParts();

        expect(() => buildCandidateReceipt({
            ...parts,
            source: { ...parts.source, tag: 'v9.9.9' },
        })).toThrow(/source\.tag must be "v0\.1\.2"/u);
    });

    it('refuses to build a receipt for a mutable workflow reference', () => {
        const parts = candidateParts();

        expect(() => buildCandidateReceipt({
            ...parts,
            quoin: { ...parts.quoin, sha: 'main' },
        })).toThrow(/quoin\.sha/u);
    });
});

describe('buildReleaseRecord', () => {
    it('derives the protocol constants', () => {
        const record = buildReleaseRecord(releaseParts());

        expect(record.schema).toBe(RECEIPT_SCHEMA_VERSION);
        expect(record.protocol).toBe(PROTOCOL);
        expect(Object.keys(record)).toEqual([
            'schema',
            'protocol',
            'candidateReceiptSha256',
            'package',
            'candidate',
            'registry',
            'source',
        ]);
    });

    it('refuses to record public bytes that differ from the candidate', () => {
        const parts = releaseParts();

        expect(() => buildReleaseRecord({
            ...parts,
            registry: { ...parts.registry, sha256: 'a'.repeat(64) },
        })).toThrow(/registry\.sha256 must equal candidate\.sha256\./u);
    });

    it('refuses to record a release without verified provenance', () => {
        const parts = releaseParts();

        expect(() => buildReleaseRecord({
            ...parts,
            registry: { ...parts.registry, provenanceVerified: false },
        })).toThrow(/registry\.provenanceVerified must be true\./u);
    });
});

describe('validateCandidateReceipt', () => {
    it('reports every failure at once', () => {
        const receipt = buildCandidateReceipt(candidateParts());
        const broken = {
            ...receipt,
            quoin: { ...receipt.quoin, sha: 'HEAD' },
            repository: { ...receipt.repository, id: 0 },
            run: { ...receipt.run, attempt: 1.5 },
        };

        expect(validateCandidateReceipt(broken)).toEqual([
            'quoin.sha must be a 40-character lowercase hexadecimal commit SHA.',
            'repository.id must be a positive integer.',
            'run.attempt must be a positive integer.',
        ]);
    });

    it('rejects uppercase commit digests', () => {
        const receipt = buildCandidateReceipt(candidateParts());
        const broken = { ...receipt, source: { ...receipt.source, commit: COMMIT.toUpperCase() } };

        expect(validateCandidateReceipt(broken)).toContain(
            'source.commit must be a 40-character lowercase hexadecimal commit SHA.',
        );
    });

    it('rejects restricted access and renamed tarballs', () => {
        const receipt = buildCandidateReceipt(candidateParts());

        expect(validateCandidateReceipt({
            ...receipt,
            package: { ...receipt.package, access: 'restricted' },
        })).toContain('package.access must be "public".');
        expect(validateCandidateReceipt({
            ...receipt,
            tarball: { ...receipt.tarball, filename: 'smoque-0.1.2.tgz' },
        })).toContain('tarball.filename must be "package.tgz".');
    });

    it('rejects ambiguous dist tags', () => {
        const receipt = buildCandidateReceipt(candidateParts());
        for (const distTag of ['1', '1.0.0', '', '-alpha']) {
            expect(validateCandidateReceipt({
                ...receipt,
                package: { ...receipt.package, distTag },
            })).toContain('package.distTag must be a nonnumeric npm dist-tag.');
        }
    });

    it('rejects package names npm would not accept', () => {
        const receipt = buildCandidateReceipt(candidateParts());
        for (const name of ['Smoque', 'smo que', '@scope', '../smoque']) {
            expect(validateCandidateReceipt({
                ...receipt,
                package: { ...receipt.package, name },
            })).toContain('package.name must be a valid npm package name.');
        }
    });

    it('rejects repository names that are not owner/name', () => {
        const receipt = buildCandidateReceipt(candidateParts());
        for (const name of ['smoque', 'zsumz/smoque/extra', '/smoque', 'zsumz/']) {
            expect(validateCandidateReceipt({
                ...receipt,
                repository: { ...receipt.repository, name },
            })).toContain('repository.name must be an owner/name GitHub repository.');
        }
    });

    it('rejects workflow references outside .github/workflows', () => {
        const receipt = buildCandidateReceipt(candidateParts());
        for (const workflow of ['stage.yml', 'zsumz/quoin/stage.yml', 'zsumz/quoin']) {
            expect(validateCandidateReceipt({
                ...receipt,
                quoin: { ...receipt.quoin, workflow },
            })).toContain(
                'quoin.workflow must be an owner/name/.github/workflows/<file>.yml reference.',
            );
        }
    });

    it('rejects an integrity value that does not encode the recorded sha512', () => {
        const receipt = buildCandidateReceipt(candidateParts());
        const other = hashTarball(Buffer.from('different bytes', 'utf8'));

        expect(validateCandidateReceipt({
            ...receipt,
            tarball: { ...receipt.tarball, integrity: other.integrity },
        })).toContain('tarball.integrity must be the base64 SRI form of tarball.sha512.');
    });
});

describe('validateReleaseRecord', () => {
    it('accepts a record built from verified parts', () => {
        expect(validateReleaseRecord(buildReleaseRecord(releaseParts()))).toEqual([]);
    });

    it('rejects a candidate receipt digest that is not sha256', () => {
        const record = buildReleaseRecord(releaseParts());

        expect(validateReleaseRecord({ ...record, candidateReceiptSha256: DIGEST.sha512 }))
            .toContain(
                'candidateReceiptSha256 must be a 64-character lowercase hexadecimal SHA-256'
                + ' digest.',
            );
    });
});
