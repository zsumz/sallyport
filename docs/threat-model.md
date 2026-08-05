# Threat model

What quoin defends against, how, and what it explicitly does not defend
against. The mechanisms are the ten security invariants in
[protocol](./protocol.md#10-security-invariants); this document maps threats
onto them.

## Defended

### Compromised package scripts

A malicious dependency, build script, test, or smoke script runs inside the
release pipeline. It is the most likely compromise, because package code
executes on every release by definition.

Quoin splits authority so that package code never holds any.

`prepare` runs package code — `npm ci`, `release:check`, the pack, and
`release:smoke` — with `contents: read` only. It has no OIDC token, no write
permission, and no secrets. Nothing it produces can publish.

`stage` holds the OIDC credential and runs no package code at all: no caller
checkout, no Quoin checkout, no `npm ci`, no `npm run`, no local Actions, no
cache restoration, no inherited secrets. It validates the candidate receipt
with embedded dependency-free code, verifies the candidate digest, and invokes
`npm stage publish` as an argument array built only from validated values.

The same split covers GitHub Release authority. `verify` runs the public
smoke — package code again — and cannot write. `release` can write and runs
no package code, has no checkout, no dependency installation, and no
arbitrary release command.

Invariants 2, 3, and 8.

### Stolen npm publishing token

There is no token to steal. CI authenticates with short-lived OIDC credentials
issued per run, and the package is configured to require two-factor
authentication and disallow token publishing. The generated caller workflow
carries no secrets and never uses `secrets: inherit`; `quoin check`
fails if a publishing token appears in a workflow at all.

Even the OIDC credential is not a publishing credential: the trusted publisher
is registered with `--allow-stage-publish`, so it can stage and cannot run an
ordinary `npm publish`.

Invariants 1 and 5.

### Tarball tampered between validation and publication

The classic gap: what was tested is not what was shipped. Quoin closes it by
never producing a second tarball.

The candidate is packed exactly once, by Quoin, with `--ignore-scripts`. Its
SHA-256, SHA-512, SRI integrity, and byte length are recorded immediately, and
the packed manifest is revalidated from inside the archive. `release:smoke`
receives a **copy**; the authoritative `package.tgz` is never handed to package
code after its digest is recorded, and the copy is hashed afterward to prove it
was not modified. The staging job verifies the digest again before publishing,
and finalization requires the tarball downloaded from the public registry to be
byte-for-byte equal to the candidate.

Invariant 4.

### Compromised update to the central workflows

Quoin is shared machinery, so a malicious change to it would otherwise reach
every consumer at once.

Consumers never reference a branch or a tag. The generated caller pins both
`stage.yml` and `finalize.yml` to the same full 40-character commit SHA, and
`quoin check` fails if the two SHAs differ or if either is not a full
SHA. Upgrading is an explicit, atomic, reviewable commit produced by
`quoin init --upgrade`. A new Quoin commit reaches a consumer only when
that consumer merges it.

The same rule applies to third-party Actions used inside the reusable
workflows: all are pinned to full commit SHAs, never to moving version tags.

Finalization additionally requires that the candidate's recorded
reusable-workflow SHA equal the currently pinned finalizer SHA, so a candidate
produced by different central code cannot be finalized by this one.

Invariants 7 and 9.

### Registry substitution

Something between staging and the public registry serves different bytes than
the ones approved.

Finalization treats the registry as untrusted. It waits for convergence, then
requires: the exact version exists; the expected dist-tag points to it; the
registry `dist.integrity` matches the candidate; the downloaded tarball's
SHA-256, SHA-512, and byte length equal the candidate's; the packed manifest
matches name and version; the registry signature is valid; and an npm
provenance attestation exists and identifies the expected GitHub repository
and workflow run. The public tarball is then smoked again with the consumer's
own `release:smoke`.

The convergence retry loop is deliberately narrow. It retries only temporary
visibility states, and never retries a cryptographic or metadata mismatch, so
a substitution cannot be waited out.

Invariant 10.

### GitHub Release tampering

Release assets are the artifact people download when they distrust the
registry, so they need their own integrity story.

The release job downloads only the already verified bundle, rechecks its
manifest and hashes, and publishes draft-first: create the draft, add the
committed release notes, attach the assets, then publish. Immutable Releases
fix assets and the tag at publication, which is why the assets must all be
attached before the draft is published.

Replay never overwrites. A rerun against a matching published release is a
successful no-op; a release for the same tag with a different receipt or
different assets is a hard failure that writes nothing. See
[recovery](./recovery.md#hard-failures).

Invariants 3, 4, and 10.

## Not defended

These are real risks that Quoin does not mitigate. Do not read the
invariants as covering them.

**Compromised maintainer 2FA.** Human approval is the last gate before a
package becomes public, and it is also the only one. An attacker who controls
the maintainer's npm account and second factor can approve a staged candidate.
Quoin reduces what CI can do; it cannot reduce what an authenticated
maintainer can do.

**Malicious source that is legitimately signed.** Quoin proves that the
published bytes came from a specific signed tag, packed once, and verified end
to end. It does not prove the source is benign. A strict-profile signature by
the configured fingerprint authorizes the release; code review, not Quoin,
decides whether the code deserves it.

**GitHub or npm platform compromise.** The protocol trusts GitHub Actions to
isolate jobs and honor permissions, GitHub's OIDC issuer, and npm's staging,
signature, and provenance infrastructure. A compromise of either platform's
control plane is outside the model.

**The bootstrap publication.** Staged publishing and trusted-publisher
configuration require the package to already exist, so a brand-new package
needs one manual, 2FA-authenticated publication before Quoin can take over.
That first version is published outside the protocol and gets none of its
guarantees. See [releasing](./releasing.md) for how quoin handles its
own bootstrap.

**Out-of-scope configurations.** v0.1.0 covers public packages on public
GitHub repositories, GitHub-hosted Linux runners, and npm. Workspaces, private
packages, other registries, other package managers, and self-hosted runners
are unsupported, not hardened.
