# Setting up a consumer repository

One-time setup per package. sallyport never mutates repository settings; every
step below is performed by a maintainer. See [protocol](./protocol.md) for
what each setting protects.

## 1. Install the workflow

From the repository root:

```sh
npx sallyport init --strict
```

`init` reads `package.json` and `package-lock.json`, detects the GitHub
repository, verifies that this is one root public package, checks for the
`release:check` and `release:smoke` scripts, and generates
`.github/workflows/sallyport.yml` with both reusable workflows pinned to the
exact sallyport commit associated with the installed CLI. With `--strict` it
also creates the `docs/releases/` and `etc/` directories, prints the npm trust
command and the environment checklist, and finishes by running
`sallyport check`.

Use plain `init` for the standard profile:

```sh
npx sallyport init
```

`init` does not invent a smoke test. Writing `release:smoke` is the consumer's
job; see [protocol](./protocol.md#releasesmoke) for its contract.

## 2. GitHub environments

Create two environments with no secrets in either.

`npm-stage`

- Restrict deployment refs to `v*` tags.
- No secrets.
- An extra reviewer is optional; npm approval is the mandatory human boundary.

`github-release`

- Restrict deployment refs to the default branch.
- No secrets.
- A reviewer is optional.

## 3. Repository variable (strict profile)

Set the repository variable to the 40-hex OpenPGP fingerprint of the release
signing key's primary key (not a signing subkey):

```text
SALLYPORT_SIGNER_FINGERPRINT=<40-hex-fingerprint>
```

Commit the matching public key to `etc/release-signing-key.asc`. The primary
key fingerprint is the authorization boundary; sallyport does not check signer
name or email.

## 4. npm trusted publisher

Configure a stage-only trusted publisher. Example for `smoque`:

```sh
npm trust github smoque \
  --repository zsumz/smoque \
  --file sallyport.yml \
  --environment npm-stage \
  --allow-stage-publish
```

The `--file` argument is the **calling** workflow filename only, not
`stage.yml`, and not a path. npm allows one trusted publisher per package, so
an existing trust entry must be edited or revoked during migration.

## 5. npm package settings

- Set Publishing access to "Require two-factor authentication and disallow
  tokens".
- Remove obsolete automation tokens.

With `--allow-stage-publish` and tokens disallowed, CI can stage but cannot
publish, and no long-lived npm credential exists anywhere.

## 6. GitHub posture

Declare the exact GitHub Actions check names your default-branch ruleset must
require:

```json
{
  "sallyport": {
    "requiredStatusChecks": ["CI", "Coverage gate"]
  }
}
```

Then confirm each:

- protected default branch
- pull requests required
- required CI
- signed commits (strict repositories)
- linear history
- blocked force pushes
- protected `v*` tags
- immutable Releases

The default-branch ruleset must require exactly those checks from the GitHub
Actions App, use strict status checks, and have no bypass actors. The `v*`
ruleset must have no bypass actors and must block updates, deletion, and force
pushes. Sallyport deliberately leaves new tag creation unrestricted; strict
mode authorizes a release through the configured signing fingerprint.

GitHub omits `bypass_actors` when the caller cannot inspect it. In that case
`check --remote` reports `UNVERIFIED`, never `PASS`.

## 7. Verify

```sh
npx sallyport check
```

`check` inspects local deterministic state only and prints one line per
assertion:

```text
PASS package is public
PASS package-lock matches package.json
PASS repository URL matches Git remote
PASS release:check exists
PASS release:smoke exists
PASS release notes directory exists
PASS public signing key exists
PASS caller workflow is generated correctly
PASS stage and finalize use the same SHA
PASS reusable workflows use full 40-character SHAs
PASS no npm publishing token appears in workflows
PASS no direct npm publish workflow exists
```

For CI or scripting:

```sh
npx sallyport check --json
```

Audit the external settings after authenticating `gh` and npm:

```sh
npx sallyport check --remote
```

The remote pass adds checks for both GitHub environments, stage-only npm
trust, npm publishing MFA, immutable Releases, the signer variable, and the
default-branch and `v*` rulesets, including check names, source App, and bypass
actors. It is read-only. An unavailable or
unauthenticated setting is `UNVERIFIED`, never `PASS`, and makes the command
exit nonzero.

npm currently has no supported CLI readback for the package-level "require MFA
and disallow tokens" setting. Until it does, that line is `UNVERIFIED`; confirm
it manually on the package settings page. If `npm trust list` requests a second
factor, rerun with a current code in `npm_config_otp` so sallyport can verify the
trusted publisher without storing a credential.

## Upgrading

```sh
npx sallyport init --upgrade
```

`--upgrade` atomically updates both reusable-workflow SHAs so stage and
finalize always agree. It refuses to overwrite a hand-edited caller workflow
without an explicit flag.

## Next

Release the package by following the flow in
[protocol](./protocol.md#6-stage-flow--stageyml). When something goes wrong
mid-release, use [recovery](./recovery.md).
