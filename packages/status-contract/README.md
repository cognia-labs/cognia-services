# @cognia/status-contract — public status contract v1

The one schema every part of Cognia's public status service agrees on
(ADR-0211,
[decision record](../../docs/adr/en/0211-public-status-measures-the-relay-it-names.md)
copied from the app repository): the snapshot the `/status` page reads, the
observations the probe sends, the derivation rules for availability,
freshness and display status, the boundary parsers, probe request signing
and the page's runtime config. It also holds the pure half of the relay
health check (ADR-0170), because the app, the status Worker and the probe
ask the same question of a `/healthz` body.

It is source-only TypeScript with no runtime dependencies. There is no build
step: `exports` maps `.` to `src/index.ts` and `./*` to `src/*.ts`, and each
consumer bundles the source. Crypto is WebCrypto only. The modules stay
leaves: no React, no app alias, no Dexie, no native platform module and no
Node built-in, so the same file runs in a Worker, in Node and in a browser.

## Modules

Import a module by its subpath (`@cognia/status-contract/derive`), or the
root for everything `src/index.ts` re-exports.

| Module         | What it holds                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract`     | `STATUS_SCHEMA_VERSION`, component, check, profile and reason identifiers, ranges, time and latency constants, and every wire type.                                 |
| `config`       | Where the page reads its data: the official origin and API path, the runtime `<meta>` for `primary` / `mirror` / `app` mode, URL validation, token page links.      |
| `derive`       | Pure derivation: time slots, availability and coverage, latency histograms, component, overall and monitoring status, snapshot freshness, localized text.           |
| `signing`      | Per-probe signing of `POST /api/status/v1/observations`: the canonical input, `signProbeRequest` and `verifyProbeRequest` (HMAC-SHA-256, `cognia-status-probe-v1`). |
| `validate`     | Hand-written parsers for every byte that crosses a trust boundary: snapshots, observation batches, subscriptions, incidents, maintenance and probe admin writes.    |
| `fixtures`     | `createStatusFixture` and sample incidents and maintenance, built with the real derivation functions. For tests and stories only, never a production fallback.      |
| `relay-health` | `relayHealthUrl`, `classifyHealthz` (`ready` / `legacy` / `not-a-relay`) and `relayProtocolMatches` for the signaling host's `GET /healthz`.                        |
| `index`        | Re-exports `contract`, `derive`, `validate`, `config`, `signing` and `relay-health`. Not `fixtures`: import that by its subpath.                                    |

## Frozen v1

From the header of `src/contract.ts`:

> Meaning is frozen per `schemaVersion`. Adding an optional field is allowed;
> changing what an existing field means requires version 2. A reader that
> meets an unsupported version shows "unknown", never a preview.

`src/contract.test.ts` pins the schema version and the component and check
identifiers.

## Consumers

| Consumer                        | How it gets the package                                                           |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `services/status-server/worker` | `link:../../../packages/status-contract`                                          |
| `services/status-server/probe`  | `link:../../../packages/status-contract`                                          |
| `services/status-server/admin`  | `link:../../../packages/status-contract`                                          |
| cognia-next (the app)           | pnpm git dependency at the revision pinned in `integrations/cognia-services.json` |

The services import by subpath, for example
`@cognia/status-contract/contract` or `@cognia/status-contract/validate`.

The app installs

```
git+https://github.com/cognia-labs/cognia-services.git#<sha>&path:/packages/status-contract
```

where `<sha>` is the revision in its `integrations/cognia-services.json`, and
re-exports the modules from `lib/status/*` (and `relay-health` from
`lib/signaling/relay-health.ts`). The app's `/status` page components and
its Settings status link import those re-exports; `lib/constants/external-urls.ts`
re-exports `STATUS_PAGE_URL` from `@cognia/status-contract/config` directly.

## Changing it

1. Change and test it here. Keep the frozen-v1 rule: a new optional field is
   fine, a new meaning is version 2.
2. Run the status Worker, probe and admin suites, which link this package.
   `status-server.yml` reruns them on any change under `packages/status-contract/`.
3. Merge, then bump the app's pin in `integrations/cognia-services.json` and
   every other spelling of that revision its pin check
   (`scripts/ci/check-cognia-services.mjs`) lists: `package.json`,
   `cli/package.json`, `Cargo.toml` and both lockfiles.

## Develop

This package is its own pnpm root with its own lockfile. Use Node from the
repository's `.nvmrc` and the pnpm version in `package.json`.

```bash
cd packages/status-contract
pnpm install --frozen-lockfile
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
```

`.github/workflows/contracts.yml` runs `pnpm typecheck` and `pnpm test` for
this package on every change under `packages/`.
