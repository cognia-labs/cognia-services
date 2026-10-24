# AGENTS.md

Guidance for coding agents working in cognia-services. Humans: read
[CONTRIBUTING.md](CONTRIBUTING.md) first; this file is the short version plus the
traps.

## What this repository is

The cloud and self-hosted services behind Cognia, split out of the app
repository [cognia-next](https://github.com/MaxQian888/cognia-next) with their
history, and the wire contracts both sides speak. The app consumes one pinned
commit of this repository. See the [README](README.md) for the service table and
[docs/README.md](docs/README.md) for every guide.

## Rules

1. **Every unit is standalone.** Each `package.json` under `services/` and
   `packages/` is its own pnpm root with its own `pnpm-lock.yaml` and
   `pnpm-workspace.yaml`; each Rust service is its own Cargo workspace with its
   own `Cargo.lock`. Run commands inside the unit's directory. Never add a
   root workspace, never install at the root, never import across units except
   through `link:` to `packages/*` or the `path` dependency on
   `services/signaling-server/core`.
2. **Use the locked toolchains.** Node from `.nvmrc`, pnpm from the unit's
   `packageManager`, Rust from `rust-toolchain.toml`. Install with
   `pnpm install --frozen-lockfile`; build Rust with `--locked`.
3. **Contracts change here first, and carefully.** [docs/contracts.md](docs/contracts.md)
   lists what the app consumes. Keep their compatibility rules: the sync protocol
   only grows by a new `protocolVersion` or an optional field; the status
   contract is frozen at v1; files under `fixtures/` with frozen vectors are
   never regenerated. If you change a contract, say in your summary that the app
   needs a pin bump.
4. **Migrations are append-only.** Never edit an applied file under
   `services/diagnostic-server/migrations/` (sqlx checksums them) or a Worker's
   `migrations/` (D1 tracks them by name). Add a new numbered file.
5. **No real secrets.** Do not create `.env` files with real values, print
   Worker secrets, or commit credentials. Committed test keys and vectors are
   public by design.
6. **Tests come with the change**, in the unit's own suite. Run the unit's tests
   (`pnpm test` / `cargo test --locked --workspace`) and type checks before you
   report a change as done; report failures as they are.
7. **Docs move with the code.** Update the service README for configuration,
   route or operational changes, and keep `node scripts/check-docs.mjs` green.
   Links into the app repository are absolute GitHub URLs. ADR copies under
   `docs/adr/` are only refreshed from the app, never edited on their own.
8. **No deploys.** Do not run `wrangler deploy`, `fly deploy`, `deploy.yml`, push
   tags, or change GitHub Environments unless the user asks for that action
   explicitly.

## Commands

```bash
node scripts/each.mjs --list                 # every unit
node scripts/each.mjs test --only sync        # one unit by name or directory prefix
node scripts/each.mjs typecheck               # everything
node --test scripts/*.test.mjs                # repository tooling tests
node scripts/check-docs.mjs                   # Markdown links and README coverage
npx prettier@3.9.9 --check .                  # formatting (.prettierrc)
```

Per unit:

| Unit                                                             | Check                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `services/signaling-server`, `share-server`, `diagnostic-server` | `cargo test --locked --workspace`, `cargo clippy --locked --workspace --all-targets -- -D warnings`, `cargo fmt --check` |
| `services/signaling-server/worker`                               | `cargo clippy --target wasm32-unknown-unknown -- -D warnings` (no host tests)                                            |
| every pnpm unit                                                  | `pnpm typecheck`, `pnpm test`                                                                                            |
| `services/status-server/worker`                                  | install `../probe` first (its `postinstall` does it)                                                                     |
| `services/diagnostic-server/deploy`                              | `docker compose up -d --wait diagnostic-service`, then `docker compose down -v`                                          |

## Traps

- The status Worker imports the probe's sources; installing it alone fails
  until `services/status-server/probe` has its `node_modules`.
- The status page assets are built in cognia-next (`scripts/build/build-status-site.mjs`)
  from the app commit pinned in `integrations/cognia-next.json`; they are not
  built here.
- The signaling Worker is excluded from the signaling Cargo workspace because it
  targets wasm32; `cargo test` at `services/signaling-server` does not cover it.
- CI lanes are path-filtered per service. A change under `packages/` also runs
  the lanes of the services that link it.
