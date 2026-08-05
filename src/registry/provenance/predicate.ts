import { readProperty, readStringProperty } from '../download.ts';
import { UNRECOGNIZED, type ExpectedProvenance } from './model.ts';

interface BuildIdentity {
    repository: string | null;
    workflowPath: string | null;
    ref: string | null;
}

export function buildFailures(statement: unknown, expected: ExpectedProvenance): string[] {
    const predicate = readProperty(statement, 'predicate');
    const identity = slsaV1Identity(predicate) ?? slsaV02Identity(predicate);
    if (identity === null) {
        return [`${UNRECOGNIZED}: the provenance predicate has no build definition.`];
    }
    const failures: string[] = [];
    const expectedRepository = normalizeRepository(expected.repository);
    if (expectedRepository === null) {
        failures.push(`Expected repository ${expected.repository} is not an owner/name pair.`);
    } else if (identity.repository === null) {
        failures.push(`${UNRECOGNIZED}: the provenance predicate names no source repository.`);
    } else if (identity.repository !== expectedRepository) {
        failures.push(
            `Provenance repository ${identity.repository} does not match ${expected.repository}.`,
        );
    }
    if (identity.workflowPath === null) {
        failures.push(`${UNRECOGNIZED}: the provenance predicate names no workflow.`);
    } else if (identity.workflowPath !== expected.workflowPath) {
        failures.push(
            `Provenance workflow ${identity.workflowPath} does not match ${expected.workflowPath}.`,
        );
    }
    const expectedRef = normalizeTagRef(expected.tagRef);
    if (identity.ref === null) {
        failures.push(`${UNRECOGNIZED}: the provenance predicate names no source ref.`);
    } else if (normalizeTagRef(identity.ref) !== expectedRef) {
        failures.push(`Provenance ref ${identity.ref} does not match ${expectedRef}.`);
    }
    failures.push(...runFailures(predicate, expected));
    return failures;
}

function runFailures(predicate: unknown, expected: ExpectedProvenance): string[] {
    if (expected.runId === undefined) {
        return [];
    }
    const invocation = readStringProperty(
        readProperty(readProperty(predicate, 'runDetails'), 'metadata'),
        'invocationId',
    );
    if (invocation === null) {
        return [`${UNRECOGNIZED}: the provenance predicate names no workflow run.`];
    }
    if (!invocation.includes(`/actions/runs/${String(expected.runId)}/`)) {
        return [`Provenance run ${invocation} does not identify run ${String(expected.runId)}.`];
    }
    return [];
}

function slsaV1Identity(predicate: unknown): BuildIdentity | null {
    const workflow = readProperty(
        readProperty(readProperty(predicate, 'buildDefinition'), 'externalParameters'),
        'workflow',
    );
    if (typeof workflow !== 'object' || workflow === null) {
        return null;
    }
    const repository = readStringProperty(workflow, 'repository');
    return {
        repository: repository === null ? null : normalizeRepository(repository),
        workflowPath: readStringProperty(workflow, 'path'),
        ref: readStringProperty(workflow, 'ref'),
    };
}

function slsaV02Identity(predicate: unknown): BuildIdentity | null {
    const configSource = readProperty(readProperty(predicate, 'invocation'), 'configSource');
    if (typeof configSource !== 'object' || configSource === null) {
        return null;
    }
    const uri = readStringProperty(configSource, 'uri');
    const source = uri === null ? null : splitSourceUri(uri);
    return {
        repository: source === null ? null : normalizeRepository(source.repository),
        workflowPath: readStringProperty(configSource, 'entryPoint'),
        ref: source?.ref ?? null,
    };
}

function splitSourceUri(uri: string): { repository: string; ref: string | null } {
    const separator = uri.lastIndexOf('@');
    if (separator <= 0) {
        return { repository: uri, ref: null };
    }
    return { repository: uri.slice(0, separator), ref: uri.slice(separator + 1) };
}

// Duplicated from the contract area on purpose: src/registry must not depend on
// src/contract. The integrator may swap this for normalizeRepositoryUrl.
function normalizeRepository(value: string): string | null {
    let text = value.trim();
    if (text.startsWith('git+')) {
        text = text.slice(4);
    }
    text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    text = text.replace(/^[^/@]+@/, '');
    text = text.replace(/^github\.com[:/]/i, '');
    if (text.endsWith('.git')) {
        text = text.slice(0, -4);
    }
    if (text.endsWith('/')) {
        text = text.slice(0, -1);
    }
    return /^[^/\s]+\/[^/\s]+$/.test(text) ? text.toLowerCase() : null;
}

function normalizeTagRef(value: string): string {
    return value.startsWith('refs/') ? value : `refs/tags/${value}`;
}
