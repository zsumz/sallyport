export interface ArgvSpec {
    booleans?: readonly string[];
    strings?: readonly string[];
}

export interface ParsedArgv {
    positionals: string[];
    values: Record<string, string>;
    flags: Record<string, boolean>;
}

const FLAG_PATTERN = /^--?([A-Za-z][A-Za-z0-9-]*)(?:=([\s\S]*))?$/u;
const DIGITS_PATTERN = /^[0-9]+$/u;

// One dependency-free parser for every command: positional words, `--flag value`
// pairs, and boolean switches. Unknown or repeated flags fail closed.
export function parseArgv(argv: readonly string[], spec: ArgvSpec): ParsedArgv {
    const booleans = spec.booleans ?? [];
    const strings = spec.strings ?? [];
    const parsed: ParsedArgv = { positionals: [], values: {}, flags: {} };
    let index = 0;
    while (index < argv.length) {
        const token = argv[index] ?? '';
        index += 1;
        if (token === '--') {
            parsed.positionals.push(...argv.slice(index));
            break;
        }
        if (token === '-' || !token.startsWith('-')) {
            parsed.positionals.push(token);
            continue;
        }
        const match = FLAG_PATTERN.exec(token);
        const name = match?.[1];
        if (match === null || name === undefined) {
            throw new Error(`Argument parsing failed: ${token} is not a recognized flag.`);
        }
        const inline = match[2];
        if (booleans.includes(name)) {
            if (inline !== undefined) {
                throw new Error(`Argument parsing failed: --${name} does not take a value.`);
            }
            parsed.flags[name] = true;
            continue;
        }
        if (!strings.includes(name)) {
            throw new Error(`Argument parsing failed: --${name} is not a recognized flag.`);
        }
        if (Object.hasOwn(parsed.values, name)) {
            throw new Error(`Argument parsing failed: --${name} was given more than once.`);
        }
        if (inline !== undefined) {
            parsed.values[name] = inline;
            continue;
        }
        const value = argv[index];
        if (value === undefined || value.startsWith('-')) {
            throw new Error(`Argument parsing failed: --${name} requires a value.`);
        }
        index += 1;
        parsed.values[name] = value;
    }
    return parsed;
}

export function optionalValue(parsed: ParsedArgv, name: string): string | undefined {
    const value = parsed.values[name];
    return value === undefined || value.trim() === '' ? undefined : value;
}

export function requireValue(parsed: ParsedArgv, name: string): string {
    const value = optionalValue(parsed, name);
    if (value === undefined) {
        throw new Error(`Argument parsing failed: --${name} is required.`);
    }
    return value;
}

export function requirePositiveInteger(parsed: ParsedArgv, name: string): number {
    const value = requireValue(parsed, name);
    if (!DIGITS_PATTERN.test(value)) {
        throw new Error(`Argument parsing failed: --${name} must be a positive integer.`);
    }
    const parsedNumber = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsedNumber) || parsedNumber < 1) {
        throw new Error(`Argument parsing failed: --${name} must be a positive integer.`);
    }
    return parsedNumber;
}

export function requireBooleanValue(parsed: ParsedArgv, name: string): boolean {
    const value = requireValue(parsed, name);
    if (value !== 'true' && value !== 'false') {
        throw new Error(`Argument parsing failed: --${name} must be true or false.`);
    }
    return value === 'true';
}

export function hasFlag(parsed: ParsedArgv, name: string): boolean {
    return parsed.flags[name] === true;
}
