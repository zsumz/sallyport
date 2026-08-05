import { describe, expect, it } from 'vitest';

import { facadeImportFailure } from '../../scripts/architecture/policy/facades.mts';
import {
    inspectModuleLayout,
    sourceModuleLineLimit,
} from '../../scripts/architecture/policy/layout.mts';
import { layerImportFailure } from '../../scripts/architecture/policy/layers.mts';

describe('architecture policies', () => {
    it('enforces the source-module line limit', () => {
        expect(inspectModuleLayout('src/cli/large.ts', sourceModuleLineLimit + 1)).toEqual([
            'src/cli/large.ts: 151 lines exceeds the 150-line source-module limit.',
        ]);
    });

    it('rejects imports against the declared layer direction', () => {
        expect(layerImportFailure('src/contract/release.ts', 'src/cli/args.ts')).toBe(
            'contract modules must not import the cli layer.',
        );
        expect(layerImportFailure('src/cli/args.ts', 'src/contract/release.ts')).toBeUndefined();
    });

    it('requires callers outside a component to use its facade', () => {
        const facades = new Map([['src/candidate/receipt', 'src/candidate/receipt.ts']]);
        expect(facadeImportFailure(
            'src/cli/internal/create-candidate.ts',
            'src/candidate/receipt/model.ts',
            facades,
        )).toContain('must import src/candidate/receipt.ts');
        expect(facadeImportFailure(
            'src/candidate/receipt/build.ts',
            'src/candidate/receipt/model.ts',
            facades,
        )).toBeUndefined();
    });
});
