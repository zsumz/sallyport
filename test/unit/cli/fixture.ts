import { Buffer } from 'node:buffer';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { hashTarball, type TarballDigest } from '../../../src/candidate/inspect.ts';
import { packOnce } from '../../../src/candidate/pack.ts';
import {
    buildCandidateReceipt,
    type CandidateReceipt,
} from '../../../src/candidate/receipt.ts';
import type { CliEffects } from '../../../src/cli/internal/effects.ts';
import type {
    BinaryResponse,
    JsonResponse,
    RegistryFetch,
} from '../../../src/registry/download.ts';
import { runCommand } from '../../../src/report/exec.ts';

export const FIXTURE_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4';
export const OTHER_SHA = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c';
export const FIXTURE_REMOTE = 'git@github.com:zsumz/fake.git';
export const FIXTURE_REPOSITORY = 'zsumz/fake';
export const FIXTURE_NAME = 'sallyport-fixture';
export const FIXTURE_VERSION = '1.2.3';

export interface ConsumerOptions {
    name?: string;
    version?: string;
    repository?: string;
    remote?: string;
    scripts?: Record<string, string>;
    releaseNotes?: boolean;
    git?: boolean;
}

export interface Consumer {
    dir: string;
    name: string;
    version: string;
    commit: string;
}

export interface TestEffects {
    effects: CliEffects;
    outputs: Array<Record<string, string>>;
    summaries: string[];
    logs: string[];
}

export interface ZipFile {
    name: string;
    data: Uint8Array;
}

export interface CandidateFixture {
    consumer: Consumer;
    dir: string;
    receipt: CandidateReceipt;
    receiptBytes: Buffer;
    tarball: Buffer;
    digest: TarballDigest;
}

export const FIXTURE_RUN_ID = 987654321;
export const FIXTURE_REPOSITORY_ID = 1286348597;

export function makeTempRoot(label: string): string {
    return mkdtempSync(path.join(realpathSync(tmpdir()), `sallyport-${label}-`));
}

export function removeTempRoot(root: string): void {
    rmSync(root, { recursive: true, force: true });
}

export function writeJsonFile(file: string, value: unknown): void {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJsonFile(file: string): unknown {
    return JSON.parse(readTextFile(file)) as unknown;
}

export function readTextFile(file: string): string {
    return readFileSync(file, 'utf8');
}

export function writeTextFile(file: string, content: string): void {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
}

export function createConsumer(root: string, options: ConsumerOptions = {}): Consumer {
    const name = options.name ?? FIXTURE_NAME;
    const version = options.version ?? FIXTURE_VERSION;
    const repository = options.repository ?? FIXTURE_REPOSITORY;
    const dir = path.join(root, 'consumer');
    mkdirSync(dir, { recursive: true });
    writeJsonFile(path.join(dir, 'package.json'), {
        name,
        version,
        description: 'sallyport cli test fixture',
        repository: { type: 'git', url: `git+https://github.com/${repository}.git` },
        type: 'module',
        main: 'index.js',
        files: ['index.js'],
        publishConfig: { access: 'public' },
        sallyport: { requiredStatusChecks: ['CI'] },
        scripts: options.scripts ?? {
            'release:check': 'node -e "process.exit(0)"',
            'release:smoke': 'node smoke.mjs',
        },
    });
    writeJsonFile(path.join(dir, 'package-lock.json'), {
        name,
        version,
        lockfileVersion: 3,
        requires: true,
        packages: { '': { name, version } },
    });
    writeFileSync(path.join(dir, 'index.js'), 'export const sallyportFixture = true;\n');
    writeFileSync(path.join(dir, 'smoke.mjs'), SMOKE_SCRIPT);
    if (options.releaseNotes !== false) {
        writeTextFile(
            path.join(dir, 'docs', 'releases', `v${version}.md`),
            `# v${version}\n\nFixture release notes.\n`,
        );
    }
    const commit = options.git === false
        ? ''
        : initGitRepository(dir, options.remote ?? FIXTURE_REMOTE, version);
    return { dir, name, version, commit };
}

// A real npm-packed candidate plus the receipt that describes it, so the
// finalize-side commands can be exercised against genuine tarball bytes.
export function buildCandidate(root: string, options: ConsumerOptions = {}): CandidateFixture {
    const consumer = createConsumer(root, options);
    const dir = path.join(root, 'candidate');
    mkdirSync(dir, { recursive: true });
    const packed = packOnce({ consumerDir: consumer.dir, outputDir: dir, exec: runCommand });
    const tagObject = runCommand(
        'git',
        ['rev-parse', `refs/tags/v${consumer.version}`],
        { cwd: consumer.dir, env: gitEnvironment() },
    ).stdout.trim();
    const tarball = readFileSync(packed.tarballPath);
    const digest = hashTarball(tarball);
    const receipt = buildCandidateReceipt({
        sallyport: {
            version: '0.1.0',
            workflow: 'zsumz/sallyport/.github/workflows/stage.yml',
            sha: FIXTURE_SHA,
        },
        repository: {
            name: FIXTURE_REPOSITORY,
            id: FIXTURE_REPOSITORY_ID,
            defaultBranch: 'main',
        },
        source: {
            tag: `v${consumer.version}`,
            tagObject,
            commit: consumer.commit,
            signed: false,
            signerFingerprint: null,
        },
        package: {
            name: consumer.name,
            version: consumer.version,
            distTag: 'latest',
        },
        tarball: {
            bytes: digest.bytes,
            sha256: digest.sha256,
            sha512: digest.sha512,
            integrity: digest.integrity,
        },
        run: { id: FIXTURE_RUN_ID, attempt: 1 },
    });
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    writeFileSync(path.join(dir, 'candidate.json'), receiptBytes);
    return { consumer, dir, receipt, receiptBytes, tarball, digest };
}

export function initGitRepository(dir: string, remote: string, version: string): string {
    const env = gitEnvironment();
    runCommand('git', ['init', '-b', 'main'], { cwd: dir, env });
    runCommand('git', ['config', 'user.email', 'sallyport@example.com'], { cwd: dir, env });
    runCommand('git', ['config', 'user.name', 'sallyport fixture'], { cwd: dir, env });
    runCommand('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, env });
    runCommand('git', ['config', 'tag.gpgsign', 'false'], { cwd: dir, env });
    runCommand('git', ['add', '-A'], { cwd: dir, env });
    runCommand('git', ['commit', '-m', 'fixture'], { cwd: dir, env });
    runCommand('git', ['remote', 'add', 'origin', remote], { cwd: dir, env });
    runCommand('git', ['tag', '-a', `v${version}`, '-m', `v${version}`], { cwd: dir, env });
    return runCommand('git', ['rev-parse', 'HEAD'], { cwd: dir, env }).stdout.trim();
}

export function setGitRemote(dir: string, remote: string): void {
    runCommand('git', ['remote', 'set-url', 'origin', remote], {
        cwd: dir,
        env: gitEnvironment(),
    });
}

export function gitEnvironment(): Record<string, string | undefined> {
    return {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: 'sallyport fixture',
        GIT_AUTHOR_EMAIL: 'sallyport@example.com',
        GIT_COMMITTER_NAME: 'sallyport fixture',
        GIT_COMMITTER_EMAIL: 'sallyport@example.com',
    };
}

export function createEffects(
    root: string,
    overrides: Partial<CliEffects> = {},
): TestEffects {
    const outputs: Array<Record<string, string>> = [];
    const summaries: string[] = [];
    const logs: string[] = [];
    const base: CliEffects = {
        exec: runCommand,
        registry: failingRegistry(),
        cwd: root,
        env: {
            ...gitEnvironment(),
            RUNNER_TEMP: path.join(root, 'runner-temp'),
            npm_config_cache: path.join(root, 'npm-cache'),
            GITHUB_OUTPUT: undefined,
            GITHUB_STEP_SUMMARY: undefined,
            GITHUB_ACTIONS: undefined,
        },
        sleep: async () => {
            await Promise.resolve();
        },
        writeOutput: async (values) => {
            outputs.push({ ...values });
            await Promise.resolve();
        },
        writeSummary: async (markdown) => {
            summaries.push(markdown);
            await Promise.resolve();
        },
        log: (line) => {
            logs.push(line);
        },
    };
    return { effects: { ...base, ...overrides }, outputs, summaries, logs };
}

export function jsonRegistry(
    routes: (url: string) => JsonResponse,
    buffers: (url: string) => BinaryResponse = notFoundBuffer,
): RegistryFetch {
    return {
        fetchJson: async (url) => Promise.resolve(routes(url)),
        fetchBuffer: async (url) => Promise.resolve(buffers(url)),
    };
}

export function failingRegistry(): RegistryFetch {
    return jsonRegistry(() => {
        throw new Error('the registry must not be contacted in this test.');
    });
}

export function notFoundBuffer(): BinaryResponse {
    return { status: 404, body: new Uint8Array() };
}

// Minimal STORE-only zip writer so artifact retrieval can be exercised offline.
export function buildZip(files: readonly ZipFile[]): Uint8Array {
    const body: Buffer[] = [];
    const directory: Buffer[] = [];
    let offset = 0;
    for (const file of files) {
        const name = Buffer.from(file.name, 'utf8');
        const data = Buffer.from(file.data);
        const checksum = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt32LE(0, 10);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        body.push(local, name, data);

        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(20, 6);
        header.writeUInt16LE(0, 8);
        header.writeUInt16LE(0, 10);
        header.writeUInt32LE(0, 12);
        header.writeUInt32LE(checksum, 16);
        header.writeUInt32LE(data.length, 20);
        header.writeUInt32LE(data.length, 24);
        header.writeUInt16LE(name.length, 28);
        header.writeUInt16LE(0, 30);
        header.writeUInt16LE(0, 32);
        header.writeUInt16LE(0, 34);
        header.writeUInt16LE(0, 36);
        header.writeUInt32LE(0, 38);
        header.writeUInt32LE(offset, 42);
        directory.push(header, name);
        offset += local.length + name.length + data.length;
    }
    const central = Buffer.concat(directory);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return new Uint8Array(Buffer.concat([...body, central, end]));
}

const SMOKE_SCRIPT = `import { readFileSync } from 'node:fs';

const required = [
    'SALLYPORT_TARBALL',
    'SALLYPORT_PACKAGE',
    'SALLYPORT_VERSION',
    'SALLYPORT_DIST_TAG',
];
for (const key of required) {
    if (!process.env[key]) {
        console.error(\`smoke: missing \${key}\`);
        process.exit(1);
    }
}
const bytes = readFileSync(process.env.SALLYPORT_TARBALL);
if (bytes.byteLength === 0) {
    console.error('smoke: empty tarball');
    process.exit(1);
}
console.log(
    \`smoke ok \${process.env.SALLYPORT_PACKAGE}@\${process.env.SALLYPORT_VERSION}\`
    + \` \${process.env.SALLYPORT_DIST_TAG} \${bytes.byteLength}\`,
);
`;
