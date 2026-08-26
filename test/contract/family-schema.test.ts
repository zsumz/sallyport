import { describe, expect, it } from 'vitest';
import { loadSchema } from './schema-check.ts';

describe('package-family JSON Schema identities', () => {
    it.each([
        ['candidate-family.schema.json', 'sallyport/0.2'],
        ['release-family.schema.json', 'sallyport/0.2'],
    ])('publishes %s as schema 2', (filename, protocol) => {
        const schema = loadSchema(filename) as {
            $id?: string;
            properties?: { schema?: { const?: unknown }; protocol?: { const?: unknown } };
        };

        expect(schema.$id).toBe('https://github.com/zsumz/sallyport/schemas/' + filename);
        expect(schema.properties?.schema?.const).toBe(2);
        expect(schema.properties?.protocol?.const).toBe(protocol);
    });
});
