# Contributing

Thanks for helping with the Cognia services. This guide covers the local setup,
how each kind of service is built and tested, and the rules that keep the
services and the app ([cognia-next](https://github.com/MaxQian888/cognia-next))
in step. App changes belong in that repository; open issues there for app bugs.

## Toolchains

| Tool     | Version                                      | Notes                                                                                     |
| -------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Node.js  | [`.nvmrc`](.nvmrc)                           | `nvm use` or `fnm use`                                                                    |
| pnpm     | each `package.json`'s `packageManager`       | `corepack enable` picks the pinned version per package                                    |
| Rust     | [`rust-toolchain.toml`](rust-toolchain.toml) | rustup installs it on first use; the signaling Worker also needs `wasm32-unknown-unknown` |
| Docker   | with Compose v2                              | only for the diagnostics stack and building images                                        |
| Wrangler | each Worker's own devDependency              | run it through `pnpm exec wrangler`, never a global install                               |

## Layout

Every service and package is its own build unit: a pnpm root with its own
lockfile, or a Cargo workspace with its own `Cargo.lock`. Nothing is installed
at the repository root, and units never import each other except through the
contract packages (`link:` dependencies) and the signaling `core` crate.

```bash
node scripts/each.mjs --list            # every unit, its kind and directory
node scripts/each.mjs install           # install every unit's locked dependencies
node scripts/each.mjs typecheck         # tsc / cargo check everywhere
node scripts/each.mjs lint              # cargo clippy -D warnings (pnpm units have no lint step)
node scripts/each.mjs test              # every unit's tests
node scripts/each.mjs test --only sync,status-contract   # names or directory prefixes
```

The same tasks run from the root `package.json` (`pnpm test`, `pnpm typecheck`,
…). CI does not use this script: each service has its own workflow, so a change
only runs the lanes it touches.

### Working on one unit

TypeScript Workers and packages:

```bash
cd services/sync-server
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test          # vitest; the Workers run inside workerd via @cloudflare/vitest-pool-workers
pnpm dev           # wrangler dev, where the unit has it
```

Rust services:

```bash
cd services/share-server
cargo test --locked --workspace
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo fmt --check
```

Each service README has its configuration, local run and deploy details; the
[docs index](docs/README.md) lists them.

## Making a change

- **Keep a change to one service** where you can. CI lanes are path-filtered per
  service; a change that touches several runs all of them.
- **Tests come with the change.** New behaviour gets a test in the unit's own
  suite; a bug fix gets the test that would have caught it.
- **Contracts change here first.** A change to anything in
  [docs/contracts.md](docs/contracts.md) lands here with its tests, then the app
  follows with a pin bump. Frozen vector files are never regenerated.
- **Migrations are append-only.** sqlx (diagnostics) checksums applied
  migrations and D1 tracks them by name: add a new numbered file, never edit an
  applied one.
- **Secrets stay out of the tree.** `.env*` is ignored except `.env.example`;
  Worker secrets go through `wrangler secret put`, CI secrets through GitHub
  Environments.
- **Docs move with the code.** Update the service README when you change
  configuration, routes or operations. `node scripts/check-docs.mjs` must pass.
  A decision change is made in the app's ADR first; then refresh the copy in
  [`docs/adr/`](docs/adr/README.md).
- **Format.** Prettier with the root [`.prettierrc`](.prettierrc)
  (`npx prettier@3.9.9 --check .`) and `cargo fmt`.
- **Record user-visible changes** under `## Unreleased` in
  [CHANGELOG.md](CHANGELOG.md).

## Commits and pull requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) with
the service as the scope: `fix(share-server): …`, `feat(sync-server): …`,
`ci: …`, `docs: …`. Open a pull request against `main`; the template asks which
services it touches, how you tested it, and whether the app pin must follow.
`main` deploys nothing on merge: images publish as `edge`, and Workers deploy
only when someone runs `deploy.yml`.

## Releases

See [docs/releasing.md](docs/releasing.md).

## Licence

By contributing you agree that your contribution is licensed under the
[AGPL-3.0](LICENSE), the licence of this repository and of the app.
