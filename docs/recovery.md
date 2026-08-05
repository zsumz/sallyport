# Recovery

What to do when a release stops partway. The rule behind every procedure here:
never manually wave through a half-recorded stage. If the GitHub run did not
complete successfully, the staged candidate is not a release candidate — it is
evidence to be inspected and then rejected.

## Unknown staging outcome

npm may accept a staged package while the runner or GitHub fails before the
staging run records success. Never blindly retry the tag.

Find what npm actually holds:

```sh
npm stage list <package>
npm stage view <stage-id>
```

If the candidate exists on npm but the GitHub run did not complete
successfully, reject it and rerun the tag workflow:

```sh
npm stage reject <stage-id>
```

The finalizer accepts only a staging run that completed successfully, so a
stage left behind by a failed run can never be finalized. Rejecting it first
keeps the package free of an orphaned candidate and lets the rerun stage
cleanly.

## Rerunning finalize

Finalize is replay-safe by design. It takes only `candidate_run_id`,
`profile`, and `signer_fingerprint`, and derives everything else from the
candidate receipt, so rerunning it with the same run ID reaches the same
decision:

```sh
gh workflow run quoin.yml -f candidate_run_id=<run-id>
```

| Existing GitHub state         | Result                               |
| ----------------------------- | ------------------------------------ |
| No release                    | Create draft, attach assets, publish |
| Matching draft                | Resume draft and publish             |
| Matching published release    | Successful no-op                     |
| Same tag, different receipt   | Hard failure                         |
| Same tag, different assets    | Hard failure                         |
| npm package missing           | Fail without writing                 |
| npm bytes differ              | Critical failure                     |
| Provenance missing or invalid | Fail without writing                 |

### npm approved, GitHub unavailable

npm approval can succeed while GitHub is down, and the two halves are
deliberately decoupled. The npm version is already public and correct; only
the GitHub Release is missing. Wait for GitHub, then rerun finalize with the
same candidate run ID. The finalizer never republishes the npm version.

### Interrupted publication

A run that died between creating the draft and publishing it leaves a matching
draft. Rerun finalize: it resumes that draft and publishes it. Do not create
or edit the release by hand — a hand-built release will not match the verified
bundle, and the next rerun will hard-fail on the mismatch.

### Proving a no-op

A finalize rerun against an already published, matching release succeeds
without writing anything. That is the intended way to confirm a release is
complete: rerun it and watch it no-op rather than inspecting the release page
by eye.

## Hard failures

Each of these stops the run before any GitHub Release is written. None of them
should be worked around by hand.

**Same tag, different receipt.** A release already exists for this tag, built
from a different candidate. Two different candidates claim one version. Do not
delete or overwrite the release. Determine which candidate is authoritative,
and treat an unexplained second candidate as a security event.

**Same tag, different assets.** The existing release's assets do not match the
verified bundle. Same handling: investigate, do not overwrite. Immutable
Releases make published assets unchangeable, so a mismatch here means the
release did not come from this candidate.

**npm package missing.** The version is not visible on the registry after the
convergence window (30 attempts, 10-second interval, 5-minute bound). Either
the stage was never approved, or it was rejected. Confirm with
`npm stage list <package>`. If the stage is still pending, approve it and
rerun finalize; if it was rejected, rerun the tag workflow to produce a fresh
candidate.

**npm bytes differ.** The public tarball is not byte-identical to the staged
candidate. This is a critical failure, not a flake. Do not retry it — the
convergence retry loop deliberately covers only temporary visibility states,
never a cryptographic or metadata mismatch. Stop the release, preserve the run
logs and both digests, and investigate before publishing anything else.

**Provenance missing or invalid.** The provenance attestation is absent, or
does not identify the expected repository and workflow run. Fail without
writing, and treat it the same way as differing bytes: something other than
this pipeline produced the published artifact.

## Failures before staging

Failures inside `prepare` — invocation validation, metadata checks,
`release:check`, the pack, or the exact-tarball smoke — have no external side
effects. Nothing is staged, and nothing is published. Fix the repository, then
either rerun the workflow or delete and recreate the tag as appropriate.

A failed exact-tarball smoke that reports a modified copy means `release:smoke`
mutated the tarball it was handed. Fix the smoke script; see its contract in
[protocol](./protocol.md#releasesmoke).
