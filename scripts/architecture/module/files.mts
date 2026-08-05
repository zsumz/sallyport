import { readdir } from 'node:fs/promises';
import path from 'node:path';

const moduleExtensions = new Set(['.ts', '.mts']);

export async function collectModuleFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    await collect(root, files);
    return files.sort();
}

export function relativePath(root: string, file: string): string {
    return path.relative(root, file).split(path.sep).join('/');
}

async function collect(directory: string, files: string[]): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            await collect(file, files);
        } else if (entry.isFile() && moduleExtensions.has(path.extname(entry.name))) {
            files.push(file);
        }
    }
}
