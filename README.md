<br>

<p align="center">
  <img src="./quoin-logo.svg" alt="quoin" width="680">
</p>

<p align="center">
  <strong>Staged npm releases without publishing credentials.</strong>
</p>

<p align="center">
  Pack once. Stage with OIDC. Approve with 2FA. Verify the public bytes.
</p>

<p align="center">
  <a href="#install">Install</a>
  <span> · </span>
  <a href="#model">Model</a>
  <span> · </span>
  <a href="#release">Release</a>
  <span> · </span>
  <a href="./docs/setup.md">Setup</a>
  <span> · </span>
  <a href="./docs/protocol.md">Protocol</a>
  <span> · </span>
  <a href="./docs/architecture.md">Architecture</a>
</p>

<br>

## Install

```sh
npx quoin init --strict
npx quoin check
```

`init` creates one caller workflow with both reusable workflows pinned to the
full commit SHA carried by the installed CLI. `check` audits the local package,
workflow, signing, and release-note setup without changing anything.

## Model

```text
signed source tag
       ↓
validate and pack once
       ↓
smoke the exact tarball
       ↓
stage on npm with OIDC
       ↓
maintainer review and 2FA
       ↓
verify the public bytes
       ↓
immutable GitHub Release
```

CI can stage a candidate. It cannot publish one. The maintainer approves the
staged package directly with npm, and quoin finalizes only after the public
tarball matches the candidate byte for byte.

There is no hosted service, account, daemon, database, npm token, or runtime
dependency.

## Scripts

Your package owns two commands:

- `release:check` validates the tagged source without secrets or publication.
- `release:smoke` installs and tests the exact tarball supplied by quoin.

```text
QUOIN_TARBALL=/absolute/path/package.tgz
QUOIN_PACKAGE=smoque
QUOIN_VERSION=0.1.2
QUOIN_DIST_TAG=latest
```

The smoke command must use `QUOIN_TARBALL`. It must not repack the repository
or modify the supplied file.

## Release

Push a signed version tag:

```sh
git tag --sign v0.2.0 -m "package v0.2.0"
git push origin v0.2.0
```

Review and approve the staged package:

```sh
npm stage view <stage-id>
npm stage download <stage-id>
npm stage approve <stage-id>
```

Finalize with the candidate run ID from the staging summary:

```sh
gh workflow run quoin.yml -f candidate_run_id=<run-id>
```

## Guides

[Setup](./docs/setup.md) · [Protocol](./docs/protocol.md) · [Architecture](./docs/architecture.md) · [Recovery](./docs/recovery.md) · [Threat model](./docs/threat-model.md) · [Releasing quoin](./docs/releasing.md) · [Security](./SECURITY.md)

## Development

```sh
npm ci
npm run validate
npm run release:check
```

quoin uses `eslint-config-rubric`, a 150-line source-module ceiling, pure
facades, one-way source layers, and a cycle-free runtime graph. The rules are
executable; see [Architecture](./docs/architecture.md).

## Support

quoin supports public, single-package npm repositories on GitHub-hosted Linux
runners. Consumers use npm with a root `package-lock.json` and Node `22.18.0`
or newer. The release jobs pin Node `24.19.0` and npm `11.17.0`.

Workspaces, private packages, other registries, other package managers, and
self-hosted runners are outside the v0.1.0 contract.

## License

MIT
