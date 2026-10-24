# Contracts shared with the app

This repository owns the wire contracts that the services and the Cognia app
([cognia-next](https://github.com/MaxQian888/cognia-next)) both speak. The app
consumes one commit of this repository, pinned in its
`integrations/cognia-services.json`, and checks every copy it keeps against that
commit. A contract therefore changes here first.

## What is shared

| Contract                    | Lives here                                              | Used here by                                     | The app consumes it as                                                                                                 |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Signaling envelope crate    | `services/signaling-server/core`                        | signaling server, signaling Worker (`path` deps) | Cargo git dependency `cognia-signaling-core` (`[workspace.dependencies]`, `rev` = the pin)                             |
| Account sync protocol v1    | `packages/sync-protocol` (`@cognia/sync-protocol`)      | sync Worker (`link:`)                            | pnpm git dependency in the root and `cli/` package                                                                     |
| Public status v1 + relay    | `packages/status-contract`                              | status Worker, probe, admin CLI (`link:`)        | pnpm git dependency, re-exported by `lib/status/*` and `lib/signaling/relay-health.ts`                                 |
| Tenant grant wire vector    | `services/share-server/fixtures/grant-wire-vector.json` | share server and Worker parity tests             | byte-identical copy `crates/cognia-tenant-auth/fixtures/grant-wire-vector.json`; `cognia-tenant-auth` mints the grants |
| Diagnostic HTTP API         | `services/diagnostic-server/openapi.yaml`               | diagnostic server                                | byte-identical copy `protocol/cognia-services/diagnostic-openapi.yaml`                                                 |
| Share limits and constants  | `services/share-server/share-constants.json`            | share server and Worker                          | byte-identical copy `protocol/cognia-services/share-constants.json`                                                    |
| RFC 8785 (JCS) vectors      | `packages/sync-protocol/fixtures/jcs-vectors.json`      | `sync-protocol` tests                            | `lib/plugin/character-pack/__fixtures__/jcs-vectors.json`, compared by its `vectors` list                              |
| Diagnostic tenant isolation | `services/diagnostic-server/src/db.rs`, `migrations/`   | diagnostic server                                | `crates/cognia-tenant-auth` parses them in an ignored test run with `COGNIA_SERVICES_ROOT`                             |
| Status page asset headers   | `services/status-server/worker`                         | status Worker                                    | `scripts/build/build-status-site.test.mjs` reads the Worker with `COGNIA_SERVICES_ROOT`                                |

The package URLs the app uses look like
`git+https://github.com/cognia-labs/cognia-services.git#<sha>&path:/packages/sync-protocol`.
Both packages ship TypeScript source (no build step); the app transpiles them.

## How the app checks the pin

The app's `scripts/ci/check-cognia-services.mjs` (`pnpm cognia-services:check`)
fails when the pin file, the Cargo `rev`, the three package URLs, `Cargo.lock` or
`pnpm-lock.yaml` disagree. Its `cognia-services` CI lane also checks the pinned
commit out under `.cache/cognia-services`, compares every copy in the table
byte for byte (vectors by content), runs the signaling room-id vector of the
pinned crate, and runs the parity suites above with `COGNIA_SERVICES_ROOT` set.

The opposite direction is pinned too: the status Worker deploy builds the
public status page from the app commit in [`integrations/cognia-next.json`](../integrations/cognia-next.json).

## Changing a contract

1. Change it here with its tests. Keep the compatibility rules of the contract:
   the sync protocol only grows by a new `protocolVersion` or an optional field,
   the status contract is frozen at v1 (see its README), and the frozen vector
   files are never regenerated. A change to them is a wire break.
2. Merge to `main` and let the lanes for every affected service pass.
3. In cognia-next, in one change: set `integrations/cognia-services.json` to the
   new commit, update the `rev` in `Cargo.toml` and the three package URLs, run
   `cargo update -p cognia-signaling-core` and `pnpm install`, refresh any copied
   file, then run `pnpm cognia-services:fetch` and
   `node scripts/ci/check-cognia-services.mjs --services-root .cache/cognia-services`.
   The app's guide is
   [`docs/development/services-extraction.md`](https://github.com/MaxQian888/cognia-next/blob/dev/docs/development/services-extraction.md).

A service that is wire-compatible across the change can deploy before the app
pin moves. A breaking change needs both sides to accept the old and the new form
for a release, or a coordinated deploy.
