export const INIT_USAGE = [
    'Generate and verify a sallyport caller workflow.',
    '',
    'Usage:',
    '  sallyport init [--strict] [--upgrade] [--force] [--sha <40-hex>]',
    '',
    'Options:',
    '  --strict   Require signed tags; create docs/releases/ and etc/.',
    '  --upgrade  Rewrite only the two pinned reusable-workflow commits.',
    '  --force    Upgrade a caller workflow that lost its generated marker.',
    '  --sha      Pin both reusable workflows to this sallyport commit.',
    '  --help     Show this help.',
].join('\n');

export const CHECK_USAGE = [
    'Audit sallyport release readiness.',
    '',
    'Usage:',
    '  sallyport check [--remote] [--json]',
    '',
    'Options:',
    '  --remote   Also audit GitHub and npm settings without changing them.',
    '  --json     Print { checks, ok } instead of text.',
    '  --help     Show this help.',
    '',
    'Remote settings that cannot be authenticated are UNVERIFIED.',
    'Exits 1 when a check fails or remains unverified.',
].join('\n');

export const USAGE = [
    'sallyport — staged npm releases for GitHub Actions.',
    '',
    'Usage:',
    '  sallyport init [options]',
    '  sallyport check [options]',
    '  sallyport --version',
    '  sallyport --help',
    '',
    'Run sallyport init --help or sallyport check --help for command options.',
    '',
    'internal <command>  Reserved for reusable workflows; not a public API.',
].join('\n');

export function isHelpRequest(argv: readonly string[]): boolean {
    return argv.length === 1
        && (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help');
}
