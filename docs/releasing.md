# Releasing sallyport

sallyport releases itself with its own protocol: stage, approve, verify, release.
The manual bootstrap is over and its publishing helper has been removed.

## Historical bootstrap

Staged publishing and trusted-publisher configuration both require the npm
package to already exist, so a completely new package needs one initial
publication outside the protocol. It gets none of sallyport's guarantees; see the
[threat model](./threat-model.md#not-defended).

`0.1.0-alpha.0` was published by that manual path. The live fixture stage and
reject cycles, full self-hosted release, external canary, and replay proof did
**not** precede it. The alpha is bootstrap evidence only; it is not protocol
acceptance evidence, and the missing work cannot be claimed retroactively.

The bootstrap-only `publish:alpha` command has been deleted. Never recreate or
reuse it to finish a release.

## Acceptance before stable

Before `0.1.0`, produce fresh, observable proof in this order:

1. Publish a dedicated live fixture and complete one stage and one reject cycle.
2. Release a later sallyport alpha through sallyport end to end, then prove
   finalizer replay is harmless.
3. Release one external consumer through the pinned reusable workflows.

Only those runs count toward stable acceptance.

## One-time setup

Required for sallyport and every consumer:
`npm-stage` and `github-release` environments with no secrets, `npm-stage`
restricted to `v*` tags and `github-release` restricted to the default branch,
the stage-only trusted publisher for `sallyport.yml`, 2FA required with
tokens disallowed, and `SALLYPORT_SIGNER_FINGERPRINT` set to the release
signing key's 40-hex fingerprint with the public key committed at
`etc/release-signing-key.asc`. Full detail in [setup](./setup.md).

Protect the default branch with required pull requests, CI, signed commits,
linear history, and blocked force pushes. Protect `v*` tags. Keep immutable
Releases enabled.

## Prepare

1. Start from a clean, current default branch.
2. Finish every reusable-workflow, CLI, schema, test, and release-runtime
   change, then commit that complete implementation checkpoint.
3. Record that commit's full SHA in `src/cli/pins.ts` and both generated caller
   refs. A commit cannot pin itself.
4. After the checkpoint, change only the release layer: `package.json`,
   `package-lock.json`, `src/cli/pins.ts`, `.github/workflows/sallyport.yml`,
   and `docs/releases/v<version>.md`. CI rejects any other path after the pin.
5. Update `package.json` and `package-lock.json` to the same version and add
   concise notes at `docs/releases/v<version>.md`.
6. Run `npm run release:check`. Its protocol-pin gate proves the pinned commit
   contains the complete implementation, not merely the last workflow edit.
7. Run `npx sallyport@alpha check`.
8. Run `npx sallyport@alpha check --remote` with authenticated GitHub and npm
   CLIs. Resolve every `FAIL`; manually confirm any `UNVERIFIED` npm setting.
9. Commit as `chore(release): v<version>` with the configured OpenPGP key.
10. Push and wait for the complete CI matrix.

## Stage

Create and push an annotated, signed tag:

```sh
git tag --sign v<version> -m "sallyport v<version>"
git push origin v<version>
```

The caller's `prepare` job runs the package gate and emits only a tarball. A
fresh `seal` job rebinds the tag, commit, signer, branch, manifest, and digests
before authoring the receipt. The OIDC job downloads that sealed artifact by ID
and stages it. It cannot publish directly.

Note the stage ID and the candidate run ID from the staging summary.

## Approve

Review the staged package on npmjs.com or from the terminal:

```sh
npm stage view <stage-id>
npm stage download <stage-id>
```

Compare the downloaded SHA-256 with `tarball.sha256` in `candidate.json`, then
approve with maintainer 2FA:

```sh
npm stage approve <stage-id>
```

## Finalize

Run the finalizer with the candidate run ID from the staging summary:

```sh
gh workflow run sallyport.yml -f candidate_run_id=<run-id>
```

It requires the derived dist-tag to point at that version, downloads and
smokes the public registry tarball, verifies byte equality, registry
signature, and provenance attestation, then creates the immutable GitHub
Release draft-first from the existing signed tag and committed release notes.

Confirm the npm version, dist-tag, integrity, provenance, GitHub Release, and
remote tag before announcing completion.

If anything stops partway, use [recovery](./recovery.md) — never finish a
half-recorded release by hand.
