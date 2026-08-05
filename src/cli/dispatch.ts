import { hasFlag, optionalValue, parseArgv } from './args.ts';
import { formatCheckReport, runCheck } from './check.ts';
import { CHECK_USAGE, INIT_USAGE, isHelpRequest, USAGE } from './help.ts';
import { runInit } from './init.ts';
import { createCandidateCommand } from './internal/create-candidate.ts';
import { createReleaseBundleCommand } from './internal/create-release-bundle.ts';
import { defaultEffects, type CliEffects } from './internal/effects.ts';
import { fetchCandidateCommand } from './internal/fetch-candidate.ts';
import { inspectSourceCommand } from './internal/inspect-source.ts';
import { packCommand } from './internal/pack.ts';
import { smokeCommand } from './internal/smoke.ts';
import { verifyPublicCommand } from './internal/verify-public.ts';
import { readsallyportVersion } from './version.ts';

export { CHECK_USAGE, INIT_USAGE, USAGE } from './help.ts';

const INTERNAL_COMMANDS = [
    'inspect-source',
    'pack',
    'smoke',
    'create-candidate',
    'fetch-candidate',
    'verify-public',
    'create-release-bundle',
] as const;

export async function runCli(
    argv: readonly string[],
    effects: CliEffects = defaultEffects(),
): Promise<number> {
    const command = argv[0];
    const rest = argv.slice(1);
    if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
        effects.log(USAGE);
        return 0;
    }
    if (command === '--version' || command === '-v' || command === 'version') {
        effects.log(await readsallyportVersion());
        return 0;
    }
    switch (command) {
        case 'init':
            return initCommand(rest, effects);
        case 'check':
            return checkCommand(rest, effects);
        case 'internal':
            return internalCommand(rest, effects);
        default:
            throw new Error(`Unknown command ${command}; run sallyport --help.`);
    }
}

async function initCommand(
    argv: readonly string[],
    effects: CliEffects,
): Promise<number> {
    if (isHelpRequest(argv)) {
        effects.log(INIT_USAGE);
        return 0;
    }
    const parsed = parseArgv(argv, {
        booleans: ['strict', 'upgrade', 'force'],
        strings: ['sha'],
    });
    return runInit({
        dir: effects.cwd,
        strict: hasFlag(parsed, 'strict'),
        upgrade: hasFlag(parsed, 'upgrade'),
        force: hasFlag(parsed, 'force'),
        sha: optionalValue(parsed, 'sha'),
        exec: effects.exec,
        log: effects.log,
    });
}

async function checkCommand(
    argv: readonly string[],
    effects: CliEffects,
): Promise<number> {
    if (isHelpRequest(argv)) {
        effects.log(CHECK_USAGE);
        return 0;
    }
    const parsed = parseArgv(argv, { booleans: ['json', 'remote'] });
    const report = await runCheck({
        dir: effects.cwd,
        exec: effects.exec,
        env: effects.env,
        remote: hasFlag(parsed, 'remote'),
    });
    effects.log(hasFlag(parsed, 'json')
        ? JSON.stringify(report, null, 2)
        : formatCheckReport(report).trimEnd());
    return report.ok ? 0 : 1;
}

async function internalCommand(
    argv: readonly string[],
    effects: CliEffects,
): Promise<number> {
    const command = argv[0] ?? '';
    const rest = argv.slice(1);
    switch (command) {
        case 'inspect-source':
            await inspectSourceCommand(rest, effects);
            return 0;
        case 'pack':
            await packCommand(rest, effects);
            return 0;
        case 'smoke':
            await smokeCommand(rest, effects);
            return 0;
        case 'create-candidate':
            await createCandidateCommand(rest, effects);
            return 0;
        case 'fetch-candidate':
            await fetchCandidateCommand(rest, effects);
            return 0;
        case 'verify-public':
            await verifyPublicCommand(rest, effects);
            return 0;
        case 'create-release-bundle':
            await createReleaseBundleCommand(rest, effects);
            return 0;
        default:
            throw new Error(
                `Unknown internal command ${command === '' ? '<missing>' : command};`
                + ` expected one of ${INTERNAL_COMMANDS.join(', ')}.`,
            );
    }
}
