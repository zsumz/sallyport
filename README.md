# quoin

A reusable, staged npm release protocol for GitHub Actions with a tiny
installer CLI.

Quoin owns the dangerous and repetitive half of publishing: validating the
tagged source, packing one authoritative tarball, staging it on npm with
short-lived OIDC credentials, and publishing an immutable GitHub Release only
after the public bytes have been verified. Your package keeps two jobs: prove
its source is ready to release, and prove the exact packed tarball works.

There is no hosted service, account registration, daemon, database, or npm
token.

## Pipeline

```text
source tag
   ↓
validate package
   ↓
pack exact tarball once
   ↓
smoke exact tarball
   ↓
stage exact tarball on npm
   ↓
human reviews and approves with 2FA
   ↓
verify exact public npm bytes
   ↓
publish immutable GitHub Release
```

## Install

```sh
npx quoin init --strict
npx quoin check
```

`init` generates exactly one file, `.github/workflows/quoin.yml`, with
both reusable workflows pinned to the full commit SHA that matches the
installed CLI. `check` inspects local state only. See
[setup](./docs/setup.md) for the one-time environment, variable, and npm trust
configuration.

## Release

Tag and push:

```sh
git tag --sign v0.2.0 -m "package v0.2.0"
git push origin v0.2.0
```

Quoin validates the tag, runs your gate, packs one tarball, smokes that
exact tarball, and stages it on npm. CI cannot publish.

Review the staged bytes and approve with maintainer 2FA:

```sh
npm stage view <stage-id>
npm stage download <stage-id>
npm stage approve <stage-id>
```

Finalize with the candidate run ID printed in the staging summary:

```sh
gh workflow run quoin.yml -f candidate_run_id=<run-id>
```

Finalize verifies the public registry bytes, signature, and provenance, smokes
the public tarball, then publishes the immutable GitHub Release.

## The two scripts you own

`release:check` runs against the tagged source tree: install and test the
package, run type checks, linting, architecture checks, coverage, and
source-level tests, and produce the final publishable build output. It takes
no secrets, never publishes or stages anything, and never modifies package
versions.

`release:smoke` proves the exact tarball. Quoin hands it a copy through
environment variables, then verifies that copy afterward:

```text
QUOIN_TARBALL=/absolute/path/package.tgz
QUOIN_PACKAGE=smoque
QUOIN_VERSION=0.1.2
QUOIN_DIST_TAG=latest
```

The script installs `QUOIN_TARBALL` into an isolated fixture with
`--ignore-scripts` and asserts package-specific contracts. It never repacks
the repository, never publishes, and never modifies the supplied tarball. This
is the only package-specific part of the release system, and Quoin does not
invent it for you.

## Docs

- [Protocol](./docs/protocol.md) — the normative contract, stage and finalize
  flows, receipt shapes, replay behavior, and security invariants.
- [Setup](./docs/setup.md) — one-time environments, repository variables, npm
  trust, and CLI usage.
- [Recovery](./docs/recovery.md) — unknown staging outcomes, replay semantics,
  and hard failures.
- [Threat model](./docs/threat-model.md) — what Quoin defends against and
  what it does not.
- [Releasing](./docs/releasing.md) — how quoin releases itself.

## Requirements

GitHub Actions on GitHub-hosted Linux runners, a public GitHub repository, a
public npm package, npm with `package-lock.json`, and one root package per
repository. Staged publishing requires Node `22.14` or newer and npm `11.15`
or newer; Quoin's own jobs pin Node `24.19.0` and npm `11.17.0`.

npm workspaces, private packages, other registries, other package managers,
and self-hosted runners are not supported in v0.1.0.

## License

MIT
