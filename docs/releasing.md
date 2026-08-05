# Releasing quoin

quoin releases itself with its own protocol: stage, approve, verify, release.
The first alpha is the sole exception because a package cannot configure npm
staging before it exists.

## Bootstrap alpha

Staged publishing and trusted-publisher configuration both require the npm
package to already exist, so a completely new package needs one initial
publication outside the protocol. It gets none of quoin's guarantees; see the
[threat model](./threat-model.md#not-defended).

Before bootstrapping, the acceptance work must be done: the live fixture
package `@zsumz/quoin-fixture` has exercised stage and reject cycles,
and at least one full canary has run end to end — stage, approve, verify,
immutable release, replay.

### 1. Verify

Start from a clean, current default branch at `0.1.0-alpha.0`, with notes at
`docs/releases/v0.1.0-alpha.0.md`.

Bake the reusable-workflow pin into the CLI: set `QUOIN_WORKFLOW_SHA` in
`src/cli/pins.ts` to the SHA of the last commit that touched
`.github/workflows/`. A commit cannot reference its own SHA, so the release
commit may change only the version, the pin, and the release notes — never
the workflows. Until a release bakes that constant, `init` requires an
explicit `--sha <commit>`.

```sh
npm ci
npm run release:check
```

Pack once, then smoke that exact tarball:

```sh
npm pack --ignore-scripts
```

```sh
QUOIN_TARBALL="$PWD/quoin-0.1.0-alpha.0.tgz" \
QUOIN_PACKAGE=quoin \
QUOIN_VERSION=0.1.0-alpha.0 \
QUOIN_DIST_TAG=alpha \
npm run release:smoke
```

Record the tarball's SHA-256. It must match everything published afterward.

```sh
shasum -a 256 quoin-0.1.0-alpha.0.tgz
```

### 2. Sign

```sh
git tag --sign v0.1.0-alpha.0 -m "quoin v0.1.0-alpha.0"
git push origin v0.1.0-alpha.0
```

### 3. Publish

Publish the exact tarball that was packed and smoked above — not a fresh pack.
npm prompts for the second factor.

```sh
QUOIN_TARBALL="$PWD/quoin-0.1.0-alpha.0.tgz" npm run publish:alpha
```

Confirm the published version, `alpha`, and the registry integrity against
the recorded SHA-256. Then create the immutable GitHub Release from the signed
tag, attaching the tarball and its SHA-256.

### 4. Configure staging

```sh
npm trust github quoin \
  --repository zsumz/quoin \
  --file quoin.yml \
  --environment npm-stage \
  --allow-stage-publish
```

### 5. Remove tokens

Set Publishing access to "Require two-factor authentication and disallow
tokens" and delete any automation token used for the bootstrap. From this
point there is no npm publishing credential anywhere.

### 6. Install quoin

Generate the caller workflow with the published alpha, pinned to the alpha
tag commit:

```sh
npx quoin@alpha init --strict
npx quoin@alpha check
```

This is the `.github/workflows/quoin.yml` caller referenced by
`--file quoin.yml` above; it takes the place of the scaffold's
`release.yml` slot. The reusable `stage.yml` and `finalize.yml` stay where
they are — they are the workflows the caller calls.

### 7. Prove self-hosting

Release `0.1.0-alpha.1` through quoin. From here, follow the sections below.

## One-time setup

Already covered by the bootstrap above, and identical to any consumer:
`npm-stage` and `github-release` environments with no secrets, `npm-stage`
restricted to `v*` tags and `github-release` restricted to the default branch,
the stage-only trusted publisher for `quoin.yml`, 2FA required with
tokens disallowed, and `QUOIN_SIGNER_FINGERPRINT` set to the release
signing key's 40-hex fingerprint with the public key committed at
`etc/release-signing-key.asc`. Full detail in [setup](./setup.md).

Protect the default branch with required CI, signed commits, linear history,
and blocked force pushes. Protect `v*` tags. Keep immutable Releases enabled.

## Prepare

1. Start from a clean, current default branch.
2. Update `package.json` and `package-lock.json` to the same version.
3. Add concise notes at `docs/releases/v<version>.md`.
4. Run `npm run release:check`.
5. Run `npx quoin@alpha check`.
6. Commit as `chore(release): v<version>` with the configured OpenPGP key.
7. Push and wait for the complete CI matrix.

## Stage

Create and push an annotated, signed tag:

```sh
git tag --sign v<version> -m "quoin v<version>"
git push origin v<version>
```

The caller's `stage` job verifies the tag, signer fingerprint, package
metadata, release notes, and default-branch ancestry, reruns the release gate,
packs and smokes exactly one tarball, and uploads that tarball with
`npm stage publish`. It cannot publish directly.

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
gh workflow run quoin.yml -f candidate_run_id=<run-id>
```

It requires the derived dist-tag to point at that version, downloads and
smokes the public registry tarball, verifies byte equality, registry
signature, and provenance attestation, then creates the immutable GitHub
Release draft-first from the existing signed tag and committed release notes.

Confirm the npm version, dist-tag, integrity, provenance, GitHub Release, and
remote tag before announcing completion.

If anything stops partway, use [recovery](./recovery.md) — never finish a
half-recorded release by hand.
