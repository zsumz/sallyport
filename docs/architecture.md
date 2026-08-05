# Architecture

quoin is organized around six one-way source layers:

```text
report
  ↑
contract     candidate
  ↑             ↑
  └──────── registry
          ↑      ↑
          └── github
                ↑
               cli
```

The diagram shows dependency direction, not runtime flow. `cli` composes the
system; `report` is a leaf. `registry` may describe candidate bytes but cannot
reach into contract or CLI policy. GitHub adapters may use contracts and
registry effects, but lower layers cannot call back into GitHub.

## Module ownership

Files such as `src/candidate/receipt.ts` and `src/github/release.ts` are pure
re-export facades. Code outside their owned directory imports the facade, not
an implementation file. That keeps internal splits cheap and gives each
domain one deliberate entrypoint.

Every source module is limited to 150 lines. Generic catch-all names such as
`utils.ts`, `helpers.ts`, and `common.ts` are forbidden. New behavior belongs
in a module named for the responsibility it owns.

## Executable guardrails

```sh
npm run architecture:check
```

The architecture check fails on:

- source modules over 150 lines;
- generic junk-drawer module names;
- impure facades or imports around a facade;
- imports against the declared layer direction;
- circular runtime dependencies;
- runtime package dependencies without an explicit design decision.

`npm run validate` runs this gate with type checks, rubric linting, the full
test suite, and a package dry run. `npm run release:check` adds the coverage
gate used for release qualification.
