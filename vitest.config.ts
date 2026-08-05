import { defineConfig } from 'vitest/config';

const enforceCoverageThresholds = process.env.QUOIN_COVERAGE_CHECK === '1';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        environment: 'node',
        testTimeout: 30_000,
        hookTimeout: 30_000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/cli/main.ts'],
            reporter: ['text', 'text-summary'],
            ...(enforceCoverageThresholds
                ? {
                    thresholds: {
                        statements: 93,
                        branches: 87,
                        functions: 94,
                        lines: 93,
                    },
                }
                : {}),
        },
    },
});
