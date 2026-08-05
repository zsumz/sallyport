import { describe, expect, it } from 'vitest';
import { validateReleaseRecord } from '../../src/candidate/receipt.ts';
import { validReleaseRecord } from './examples.ts';
import {
    leafPaths,
    loadSchema,
    objectPaths,
    removeAt,
    schemaFailures,
    schemaShapeFailures,
    setAt,
} from './schema-check.ts';

const SCHEMA = loadSchema('release.schema.json');
const LABEL = 'release';
const MALFORMED = '!!';
const WRONG_TYPE: unknown[] = [];

describe('release record contract', () => {
    it('accepts a fully populated record', () => {
        expect(validateReleaseRecord(validReleaseRecord())).toEqual([]);
    });

    it('validates the example against the published schema', () => {
        expect(schemaFailures(SCHEMA, validReleaseRecord(), LABEL)).toEqual([]);
    });

    it('requires and closes every record property in the schema', () => {
        expect(schemaShapeFailures(SCHEMA, validReleaseRecord(), LABEL)).toEqual([]);
    });

    it('publishes the expected schema identity', () => {
        const document = SCHEMA as Record<string, unknown>;

        expect(document.$id)
            .toBe('https://github.com/zsumz/quoin/schemas/release.schema.json');
        expect(document.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    });

    it('rejects values that are not JSON objects', () => {
        for (const value of [null, undefined, 'record', 7, [validReleaseRecord()]]) {
            expect(validateReleaseRecord(value)).toEqual([
                'release record must be a JSON object.',
            ]);
        }
    });

    it('reports every removed field', () => {
        const record = validReleaseRecord();
        for (const path of leafPaths(record)) {
            const mutated = removeAt(record, path);

            expect(validateReleaseRecord(mutated).some((f) => f.startsWith(path)), path).toBe(true);
            expect(schemaFailures(SCHEMA, mutated, LABEL).length, path).toBeGreaterThan(0);
        }
    });

    it('reports every field replaced with the wrong JSON type', () => {
        const record = validReleaseRecord();
        for (const path of leafPaths(record)) {
            const mutated = setAt(record, path, WRONG_TYPE);

            expect(validateReleaseRecord(mutated).some((f) => f.startsWith(path)), path).toBe(true);
            expect(schemaFailures(SCHEMA, mutated, LABEL).length, path).toBeGreaterThan(0);
        }
    });

    it('reports every malformed field value', () => {
        const record = validReleaseRecord();
        for (const path of leafPaths(record)) {
            const mutated = setAt(record, path, MALFORMED);

            expect(validateReleaseRecord(mutated).some((f) => f.startsWith(path)), path).toBe(true);
            expect(schemaFailures(SCHEMA, mutated, LABEL).length, path).toBeGreaterThan(0);
        }
    });

    it('reports every removed object', () => {
        const record = validReleaseRecord();
        for (const path of objectPaths(record).filter((entry) => entry !== '')) {
            const mutated = removeAt(record, path);

            expect(validateReleaseRecord(mutated).some((f) => f.startsWith(path)), path).toBe(true);
            expect(schemaFailures(SCHEMA, mutated, LABEL).length, path).toBeGreaterThan(0);
        }
    });

    it('reports unknown properties on every object', () => {
        const record = validReleaseRecord();
        for (const path of objectPaths(record)) {
            const mutationPath = path === '' ? 'extra' : `${path}.extra`;
            const mutated = setAt(record, mutationPath, true);

            expect(
                validateReleaseRecord(mutated).some((f) => f.includes('"extra"')),
                mutationPath,
            ).toBe(true);
            expect(schemaFailures(SCHEMA, mutated, LABEL).length, mutationPath).toBeGreaterThan(0);
        }
    });

    it('refuses to record an unverified release', () => {
        for (const key of ['integrityVerified', 'signatureVerified', 'provenanceVerified']) {
            const mutated = setAt(validReleaseRecord(), `registry.${key}`, false);

            expect(validateReleaseRecord(mutated), key)
                .toContain(`registry.${key} must be true.`);
            expect(schemaFailures(SCHEMA, mutated, LABEL).length, key).toBeGreaterThan(0);
        }
    });

    // One authoritative tarball: public bytes must equal the staged candidate bytes.
    it('enforces cross-field invariants the schema cannot express', () => {
        const record = validReleaseRecord();
        const crossFieldMutations: Array<[string, unknown, string]> = [
            [
                'registry.sha256',
                'a'.repeat(64),
                'registry.sha256 must equal candidate.sha256.',
            ],
            [
                'registry.sha512',
                'b'.repeat(128),
                'registry.sha512 must equal candidate.sha512.',
            ],
            ['source.tag', 'v9.9.9', 'source.tag must be "v0.1.2" to match package.version.'],
        ];

        for (const [path, value, failure] of crossFieldMutations) {
            const mutated = setAt(record, path, value);

            expect(schemaFailures(SCHEMA, mutated, LABEL), path).toEqual([]);
            expect(validateReleaseRecord(mutated), path).toContain(failure);
        }
    });
});
