<br>

<p align="center">
  <img src="./sallyport-logo.svg" alt="sallyport" width="680">
</p>

<p align="center">
  <strong>Pack once. Approve with 2FA. Verify the bytes.</strong>
</p>

<p align="center">
  <a href="#start">Start</a>
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

## Start

```sh
npx sallyport init --strict
npx sallyport check
```

`init` writes a caller workflow pinned to the installed sallyport commit. `check`
audits the release setup without changing it.

Use `check --remote` to audit GitHub and npm posture. Missing proof is
`UNVERIFIED`, never `PASS`.

## Model

```text
signed tag → pack → seal → smoke exact bytes → stage with OIDC
           → approve with 2FA → verify → immutable GitHub Release
```

CI can stage a package. It cannot publish one. sallyport finishes only after the
registry tarball matches the staged candidate byte for byte.

No service, account, daemon, database, npm token, or runtime dependency.

## Contract

Your package provides two scripts:

- `release:check` validates the tagged source.
- `release:smoke` tests the exact tarball in `SALLYPORT_TARBALL`.

See the [Protocol](./docs/protocol.md#2-the-consumer-repository-contract) for
the complete contract.

## Release

Push a signed version tag:

```sh
git tag --sign v0.2.0 -m "package v0.2.0"
git push origin v0.2.0
```

Approve the npm stage with maintainer 2FA, then finalize its candidate run:

```sh
npm stage approve <stage-id>
gh workflow run sallyport.yml -f candidate_run_id=<run-id>
```

## Docs

[Setup](./docs/setup.md) · [Protocol](./docs/protocol.md) · [Architecture](./docs/architecture.md) · [Recovery](./docs/recovery.md) · [Threat model](./docs/threat-model.md) · [Releasing sallyport](./docs/releasing.md) · [Security](./SECURITY.md)

## Support

Public, single-package npm repositories on GitHub-hosted Linux runners. Running
the CLI requires Node `22.18.0` or newer and a root `package-lock.json`. Release
workflows use the exact Node `24.19.0` / npm `11.17.0` toolchain.

## Development

```sh
npm ci
npm run release:check
```

## License

MIT
