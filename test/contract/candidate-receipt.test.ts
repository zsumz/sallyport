import { describe, expect, it } from 'vitest';
import { validateCandidateReceipt } from '../../src/candidate/receipt.ts';
import { unsignedPrereleaseReceipt, validCandidateReceipt } from './examples.ts';
import {
    leafPaths,
    loadSchema,
    objectPaths,
    removeAt,
    schemaFailures,
    schemaShapeFailures,
    setAt,
} from './schema-check.ts';

const SCHEMA = loadSchema('candidate.schema.json');
const LABEL = 'candidate';
const MALFORMED = '!!';
const WRONG_TYPE: unknown[] = [];

describe('candidate receipt contract', () => {
    it('accepts a fully populated receipt', () => {
        expect(validateCandidateReceipt(validCandidateReceipt())).toEqual([]);
    });

    it('accepts an unsigned prerelease receipt', () => {
        expect(validateCandidateReceipt(unsignedPrereleaseReceipt())).toEqual([]);
    });

    it('validates both examples against the published schema', () => {
        expect(schemaFailures(SCHEMA, validCandidateReceipt(), LABEL)).toEqual([]);
        expect(schemaFailures(SCHEMA, unsignedPrereleaseReceipt(), LABEL)).toEqual([]);
    });

    it('requires and closes every receipt property in the schema', () => {
        expect(schemaShapeFailures(SCHEMA, validCandidateReceipt(), LABEL)).toEqual([]);
        expect(schemaShapeFailures(SCHEMA, unsignedPrereleaseReceipt(), LABEL)).toEqual([]);
    });

    it('publishes the expected schema identity', () => {
        const document = SCHEMA as Record<string, unknown>;

        expect(document.$id)
            .toBe('https://github.com/zsumz/sallyport/schemas/candidate.schema.json');
        expect(document.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    });

    it('rejects values that are not JSON objects', () => {
        for (const value of [null, undefined, 'receipt', 7, [validCandidateReceipt()]]) {
            expect(validateCandidateReceipt(value)).toEqual([
                'candidate receipt must be a JSON object.',
            ]);
        }
    });

    it('reports every removed field', () => {
        const receipt = validCandidateReceipt();
        for (const path of leafPaths(receipt)) {
            const mutated = removeAt(receipt, path);

            expect(validateCandidateReceipt(mutated).some((f) => f.startsWith(path)), path)
                .toBe(true);
            expect(schemaFailures(SCHEMA, mutated, LABEL).length, path).toBeGreaterThan(0);
        }
    });

    it('reports every field replaced with the wrong JSON type', () => {
        const receipt = validCandidateReceipt();
        for (const path of leafPaths(receipt)) {
            const mutated = setAt(receipt, path, WRONG_TYPE);

            expect(validateCandidateReceipt(mutated).some((f) => f.startsWith(path)), path)
                .toBe(true);
            expect(schemaFailures(SCHEMA, mutated, LABEL).length, path).toBeGreaterThan(0);
        }
    });

    it('reports every malformed field value', () => {
        const receipt = validCandidateReceipt();
        for (const path of leafPaths(receipt)) {
            const mutated = setAt(receipt, path, MALFORMED);

            expect(validateCandidateReceipt(mutated).some((f) => f.startsWith(path)), path)
                .toBe(true);
            expect(schemaFailures(SCHEMA, mutated, LABEL).length, path).toBeGreaterThan(0);
        }
    });

    it('reports every removed object', () => {
        const receipt = validCandidateReceipt();
        for (const path of objectPaths(receipt).filter((entry) => entry !== '')) {
            const mutated = removeAt(receipt, path);

            expect(validateCandidateReceipt(mutated).some((f) => f.startsWith(path)), path)
                .toBe(true);
            expect(schemaFailures(SCHEMA, mutated, LABEL).length, path).toBeGreaterThan(0);
        }
    });

    it('reports unknown properties on every object', () => {
        const receipt = validCandidateReceipt();
        for (const path of objectPaths(receipt)) {
            const mutationPath = path === '' ? 'extra' : `${path}.extra`;
            const mutated = setAt(receipt, mutationPath, true);

            expect(
                validateCandidateReceipt(mutated).some((f) => f.includes('"extra"')),
                mutationPath,
            ).toBe(true);
            expect(schemaFailures(SCHEMA, mutated, LABEL).length, mutationPath).toBeGreaterThan(0);
        }
    });

    // JSON Schema cannot compare two field values, so these invariants live only in the validator.
    it('enforces cross-field invariants the schema cannot express', () => {
        const crossFieldMutations: Array<[string, unknown, string]> = [
            ['source.tag', 'v9.9.9', 'source.tag must be "v0.1.2" to match package.version.'],
            [
                'tarball.integrity',
                `sha512-${'A'.repeat(86)}==`,
                'tarball.integrity must be the base64 SRI form of tarball.sha512.',
            ],
            [
                'source.signerFingerprint',
                null,
                'source.signerFingerprint must be a 40-character uppercase hexadecimal'
                + ' fingerprint when source.signed is true.',
            ],
        ];

        for (const [path, value, failure] of crossFieldMutations) {
            const mutated = setAt(validCandidateReceipt(), path, value);

            expect(schemaFailures(SCHEMA, mutated, LABEL), path).toEqual([]);
            expect(validateCandidateReceipt(mutated), path).toContain(failure);
        }
    });

    it('rejects a fingerprint recorded for an unsigned tag', () => {
        const mutated = setAt(unsignedPrereleaseReceipt(), 'source.signerFingerprint', 'A'.repeat(40));

        expect(schemaFailures(SCHEMA, mutated, LABEL)).toEqual([]);
        expect(validateCandidateReceipt(mutated)).toContain(
            'source.signerFingerprint must be null when source.signed is false.',
        );
    });
});
