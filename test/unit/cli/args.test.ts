import { describe, expect, it } from 'vitest';
import {
    hasFlag,
    optionalValue,
    parseArgv,
    requireBooleanValue,
    requirePositiveInteger,
    requireValue,
    type ArgvSpec,
} from '../../../src/cli/args.ts';

const SPEC: ArgvSpec = {
    booleans: ['strict', 'json'],
    strings: ['sha', 'consumer', 'run-id', 'signed'],
};

describe('parseArgv', () => {
    it('collects positional command words', () => {
        expect(parseArgv(['internal', 'pack'], SPEC).positionals).toEqual(['internal', 'pack']);
    });

    it('reads separated flag values', () => {
        const parsed = parseArgv(['--consumer', '/tmp/consumer'], SPEC);

        expect(parsed.values).toEqual({ consumer: '/tmp/consumer' });
    });

    it('reads inline flag values', () => {
        expect(parseArgv(['--consumer=/tmp/x'], SPEC).values).toEqual({ consumer: '/tmp/x' });
    });

    it('accepts an empty inline value', () => {
        expect(parseArgv(['--consumer='], SPEC).values).toEqual({ consumer: '' });
    });

    it('records boolean switches', () => {
        const parsed = parseArgv(['--strict', '--json'], SPEC);

        expect(parsed.flags).toEqual({ strict: true, json: true });
        expect(hasFlag(parsed, 'strict')).toBe(true);
        expect(hasFlag(parsed, 'force')).toBe(false);
    });

    it('accepts single dash flag names', () => {
        expect(parseArgv(['-strict'], SPEC).flags).toEqual({ strict: true });
    });

    it('mixes positionals and flags in any order', () => {
        const parsed = parseArgv(
            ['internal', '--consumer', '/a', 'pack', '--strict'],
            SPEC,
        );

        expect(parsed.positionals).toEqual(['internal', 'pack']);
        expect(parsed.values).toEqual({ consumer: '/a' });
        expect(parsed.flags).toEqual({ strict: true });
    });

    it('treats everything after -- as positional', () => {
        expect(parseArgv(['--strict', '--', '--consumer', '-x'], SPEC).positionals)
            .toEqual(['--consumer', '-x']);
    });

    it('treats a bare dash as a positional', () => {
        expect(parseArgv(['-'], SPEC).positionals).toEqual(['-']);
    });

    it('rejects unknown flags', () => {
        expect(() => parseArgv(['--nope', 'x'], SPEC))
            .toThrow('Argument parsing failed: --nope is not a recognized flag.');
    });

    it('rejects values given to boolean flags', () => {
        expect(() => parseArgv(['--strict=true'], SPEC))
            .toThrow('Argument parsing failed: --strict does not take a value.');
    });

    it('rejects a string flag with no value', () => {
        expect(() => parseArgv(['--consumer'], SPEC))
            .toThrow('Argument parsing failed: --consumer requires a value.');
    });

    it('rejects a string flag followed by another flag', () => {
        expect(() => parseArgv(['--consumer', '--strict'], SPEC))
            .toThrow('Argument parsing failed: --consumer requires a value.');
    });

    it('rejects repeated string flags', () => {
        expect(() => parseArgv(['--consumer', '/a', '--consumer', '/b'], SPEC))
            .toThrow('Argument parsing failed: --consumer was given more than once.');
    });

    it('rejects tokens that are not flag shaped', () => {
        expect(() => parseArgv(['--1bad'], SPEC))
            .toThrow('Argument parsing failed: --1bad is not a recognized flag.');
    });

    it('parses with no spec at all', () => {
        expect(parseArgv(['check'], {})).toEqual({
            positionals: ['check'],
            values: {},
            flags: {},
        });
    });
});

describe('argument accessors', () => {
    it('requires nonempty values', () => {
        const parsed = parseArgv(['--consumer', '/a'], SPEC);

        expect(requireValue(parsed, 'consumer')).toBe('/a');
        expect(() => requireValue(parsed, 'sha'))
            .toThrow('Argument parsing failed: --sha is required.');
    });

    it('treats blank values as absent', () => {
        const parsed = parseArgv(['--sha=   '], SPEC);

        expect(optionalValue(parsed, 'sha')).toBeUndefined();
        expect(() => requireValue(parsed, 'sha')).toThrow('--sha is required.');
    });

    it('parses positive integers', () => {
        expect(requirePositiveInteger(parseArgv(['--run-id', '42'], SPEC), 'run-id')).toBe(42);
    });

    it('rejects non positive integers', () => {
        for (const value of ['0', '-1', '1.5', 'abc', '9007199254740993']) {
            expect(() => requirePositiveInteger(parseArgv([`--run-id=${value}`], SPEC), 'run-id'))
                .toThrow('--run-id must be a positive integer.');
        }
    });

    it('parses explicit booleans', () => {
        expect(requireBooleanValue(parseArgv(['--signed', 'true'], SPEC), 'signed')).toBe(true);
        expect(requireBooleanValue(parseArgv(['--signed', 'false'], SPEC), 'signed')).toBe(false);
        expect(() => requireBooleanValue(parseArgv(['--signed', 'yes'], SPEC), 'signed'))
            .toThrow('--signed must be true or false.');
    });
});
