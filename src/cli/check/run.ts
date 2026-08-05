import { loadContext } from './context.ts';
import type { CheckOptions, CheckReport } from './model.ts';
import {
    lockfileCheck,
    packagePublicCheck,
    repositoryCheck,
    scriptCheck,
} from './package.ts';
import { runRemoteChecks } from './remote.ts';
import { directPublishCheck, npmTokenCheck } from './security.ts';
import {
    callerWorkflowCheck,
    releaseNotesCheck,
    shaAgreementCheck,
    shaLengthCheck,
    signingKeyCheck,
} from './workflow.ts';

export async function runCheck(options: CheckOptions): Promise<CheckReport> {
    const context = await loadContext(options);
    const checks = [
        packagePublicCheck(context),
        lockfileCheck(context),
        repositoryCheck(context),
        scriptCheck(context, 'release-check-script', 'release:check'),
        scriptCheck(context, 'release-smoke-script', 'release:smoke'),
        releaseNotesCheck(context),
        signingKeyCheck(context),
        callerWorkflowCheck(context),
        shaAgreementCheck(context),
        shaLengthCheck(context),
        npmTokenCheck(context),
        directPublishCheck(context),
    ];
    if (options.remote === true) {
        checks.push(...runRemoteChecks(context, options));
    }
    return {
        checks,
        ok: checks.every((check) => check.status !== 'fail' && check.status !== 'unverified'),
    };
}
