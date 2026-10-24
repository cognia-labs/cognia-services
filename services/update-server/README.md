# Update server — signed update catalog and rollout control

The control plane for Cognia updates (ADR-0224 A10,
[decision record](../../docs/adr/en/0224-an-always-on-host-is-a-peer-the-user-brings.md)
copied from the app repository): a Cloudflare Worker with one D1 database. It stores
the signed catalog bundle for each channel, answers the Tauri desktop
updater, and gives an always-on host the live rollout answer for a host
release.

It stores **no binaries** and **signs nothing**. Packages live in GitHub
Releases, the App Store, Google Play, the extension stores and npm. Catalog bundles are signed offline with keys
this service never sees, and every client verifies them against a trust root
compiled into it. A compromised Worker can withhold a release, never forge
one.

| Environment | Worker                  | D1 database              | Host               |
| ----------- | ----------------------- | ------------------------ | ------------------ |
| production  | `cognia-update`         | `cognia-updates`         | `update.cognia.cn` |
| staging     | `cognia-update-staging` | `cognia-updates-staging` | none declared      |

The staging D1 id in `wrangler.toml` is still the
`REPLACE_WITH_D1_DATABASE_ID` placeholder, so staging needs provisioning
before its first deploy.

## Layout

There is one package, the Worker. The service root holds only this README.

```
worker/
  src/index.ts        routes: catalog, Tauri manifest, rollout answer, admin surface
  src/index.test.ts   vitest in workerd against a local D1
  migrations/         D1 schema: 0001_init.sql (releases, catalogs, release_events),
                      0002_release_digest.sql (the pinned digest of a host release)
  wrangler.toml       production and staging config, D1 binding, CATALOG_CACHE_SECONDS
  vitest.config.ts    @cloudflare/vitest-pool-workers, in-memory D1, test admin secret
```

The endpoints, the rollout ladder, host releases and the offline signing
steps are in [`worker/README.md`](worker/README.md).

## Who talks to it

All in the app repository, [cognia-next](https://github.com/MaxQian888/cognia-next):

| Caller                                                                                                                        | What it does                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`lib/updates/catalog-client.ts`](https://github.com/MaxQian888/cognia-next/blob/dev/lib/updates/catalog-client.ts)           | The app reads `GET /v1/catalog`. Its `DEFAULT_CATALOG_URL` is `https://update.cognia.cn`, which must match the route in `wrangler.toml`.                        |
| `src-tauri/tauri.conf.json`                                                                                                   | The desktop updater endpoint, `GET /v1/tauri/{target}/{arch}/{current_version}`.                                                                                |
| [`crates/cognia-update-catalog`](https://github.com/MaxQian888/cognia-next/blob/dev/crates/cognia-update-catalog)             | An always-on host verifies the catalog and asks `GET /v1/rollout/host-server/host/…` before it installs (`client` feature).                                     |
| [`scripts/release/update-catalog.mjs`](https://github.com/MaxQian888/cognia-next/blob/dev/scripts/release/update-catalog.mjs) | The offline signer (`pnpm update:catalog` in the app). It holds the role keys, signs bundles, and calls `POST /v1/admin/catalog` and `POST /v1/admin/releases`. |

## Develop

The Worker is its own pnpm root with its own lockfile. Use Node from the
repository's `.nvmrc` and the pnpm version in `worker/package.json`.

```bash
cd services/update-server/worker
pnpm install --frozen-lockfile
pnpm dev             # wrangler dev
pnpm typecheck
pnpm test            # vitest in workerd with a local D1; no Cloudflare account needed
pnpm build           # dry-run bundle into dist/
pnpm migrate:local   # apply migrations/ to the local D1
```

## CI

`.github/workflows/workers.yml` (Small Workers) runs on pushes to `main` and
pull requests that touch `services/update-server/**`, the shared
`setup-package` action or the workflow itself. For `services/update-server/worker`
it installs with the locked dependencies, then runs `pnpm typecheck`,
`pnpm test` and `pnpm build`. The same matrix covers `services/logto-email`.

## Deploy

`deploy.yml` does not deploy this Worker. It deploys by hand, from
`services/update-server/worker`:

```bash
pnpm migrate                              # wrangler d1 migrations apply cognia-updates --remote
pnpm exec wrangler deploy                 # production
pnpm exec wrangler deploy --env staging   # staging, once its D1 id is filled in
```

Apply migrations before the deploy that needs them. For staging, apply them
with `pnpm exec wrangler d1 migrations apply cognia-updates-staging --remote --env staging`.

One-time provisioning (the D1 database, the `UPDATE_ADMIN_SECRET` secret) and
the client trust root are in [`worker/README.md`](worker/README.md#operator-setup).
