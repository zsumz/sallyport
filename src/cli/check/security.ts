import { CALLER_WORKFLOW_FILENAME, WORKFLOWS_DIRECTORY } from '../template.ts';
import { result, type CheckContext, type CheckResult, type WorkflowFile } from './model.ts';

const TOKEN_PATTERNS = [
    /NODE_AUTH_TOKEN/iu,
    /NPM_TOKEN/iu,
    /npm_config__auth/iu,
    /_authToken/iu,
] as const;
const DIRECT_PUBLISH_COMMAND = 'npm publish';

export function npmTokenCheck(context: CheckContext): CheckResult {
    const id = 'no-npm-token';
    const findings = scanWorkflows(context.workflows, (line) =>
        TOKEN_PATTERNS.some((pattern) => pattern.test(line)));
    if (findings.length > 0) {
        return result(
            id,
            'fail',
            `an npm publishing token appears in ${findings.join(', ')}; quoin uses OIDC only.`,
        );
    }
    return result(id, 'pass', 'no npm publishing token appears in any workflow.');
}

export function directPublishCheck(context: CheckContext): CheckResult {
    const id = 'no-direct-publish';
    const others = context.workflows.filter((file) => file.name !== CALLER_WORKFLOW_FILENAME);
    const findings = scanWorkflows(others, (line) => line.includes(DIRECT_PUBLISH_COMMAND));
    if (findings.length > 0) {
        return result(
            id,
            'fail',
            `npm publish appears in ${findings.join(', ')}; publishing must go through quoin.`,
        );
    }
    return result(id, 'pass', 'no workflow publishes outside quoin.');
}

function scanWorkflows(
    workflows: readonly WorkflowFile[],
    matches: (line: string) => boolean,
): string[] {
    const findings: string[] = [];
    for (const file of workflows) {
        for (const [index, line] of file.content.split('\n').entries()) {
            if (matches(line)) {
                findings.push(`${WORKFLOWS_DIRECTORY}/${file.name}:${String(index + 1)}`);
            }
        }
    }
    return findings;
}
