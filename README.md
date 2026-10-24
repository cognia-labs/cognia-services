# Cognia services

The cloud and self-hosted services behind [Cognia](https://github.com/MaxQian888/cognia-next),
and the wire contracts they share with the app. Every service builds, tests and
deploys on its own: its own lockfile, its own CI lane, its own image or Worker.

Cognia 的云端与自托管服务，以及它们和应用共享的协议契约。每个服务都可以独立构建、测试与部署。

| Path                         | What                                                                | Stack                               |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| `services/signaling-server`  | WebRTC signaling relay (ADR-0021); `core/` is the shared wire crate | Rust axum + Cloudflare Worker       |
| `services/share-server`      | Public share links (ADR-0037)                                       | Rust axum + Cloudflare Worker       |
| `services/status-server`     | Public status page backend, external probe, operator CLI (ADR-0211) | Cloudflare Worker + D1, Node        |
| `services/identity-server`   | Official Cognia account OIDC issuer (ADR-0215)                      | Cloudflare Worker + D1              |
| `services/sync-server`       | Account sync device registry and op log (ADR-0215)                  | Cloudflare Worker + Durable Objects |
| `services/update-server`     | Signed update catalog storage (ADR-0224)                            | Cloudflare Worker + D1              |
| `services/diagnostic-server` | Diagnostic reports and crash symbolication (ADR-0102, ADR-0135)     | Rust axum + Postgres                |
| `services/logto-email`       | Logto HTTP email connector → Cloudflare Email Sending               | Cloudflare Worker                   |
| `packages/sync-protocol`     | `@cognia/sync-protocol`: account sync protocol v1                   | TypeScript, dependency-free         |
| `packages/status-contract`   | `@cognia/status-contract`: public status contract v1 + relay health | TypeScript, dependency-free         |

ADR numbers refer to the decision records in the app repository
(`docs/content/docs/en/adr/`).

## Building a service

Each service's README has the full commands. In short:

```bash
# Rust services (toolchain pinned by rust-toolchain.toml)
cargo test --manifest-path services/signaling-server/Cargo.toml
# Workers and packages (Node from .nvmrc, pnpm from each packageManager);
# every one is its own pnpm root, so run inside its directory
pnpm install --frozen-lockfile && pnpm typecheck && pnpm test
```

Every service has its own workflow under `.github/workflows/`, triggered only
by changes to that service (and the contract packages it links).
`images.yml` publishes `ghcr.io/cognia-labs/cognia-{signaling,share,diagnostics}`:
`edge` and `sha-…` from `main`, semver tags and `latest` from `v*` tags.

## Contracts shared with the app

This repository owns the wire contracts the app consumes. The app pins one
commit of this repository (`integrations/cognia-services.json` in the app
repository) and uses that same revision for the `cognia-signaling-core` Cargo
dependency and the `@cognia/*` packages. A contract change lands here first;
the app follows with a pin bump.

## Deploying

`deploy.yml` is manual (`workflow_dispatch`) and opt-in. Targets: the
`signaling`, `share`, `status`, `identity` and `sync` Workers, and the
`signaling` and `share` Fly.io apps. Pick `environment` (`staging` /
`production`) and `target` (`all`, `workers`, `fly`, or one target).

A job runs only when the repository variable `DEPLOY_ENABLED` is `true` and
its platform's secret is present; otherwise it is skipped, never failed. The
GitHub Environments `staging` and `production` hold the same names:

| Kind     | Name                         | Notes                                                  |
| -------- | ---------------------------- | ------------------------------------------------------ |
| secret   | `CLOUDFLARE_API_TOKEN`       | Workers deploy token                                   |
| secret   | `FLY_API_TOKEN`              | `fly tokens create deploy`                             |
| variable | `CLOUDFLARE_ACCOUNT_ID`      |                                                        |
| variable | `CF_SHARE_KV_NAMESPACE_ID`   | injected into `wrangler.toml` at deploy time           |
| variable | `CF_STATUS_D1_DATABASE_ID`   | staging only; production's id is committed             |
| variable | `CF_IDENTITY_D1_DATABASE_ID` | the environment's identity D1; injected at deploy time |
| variable | `FLY_SIGNALING_APP`          | e.g. `cognia-signaling` / `-staging`                   |
| variable | `FLY_SHARE_APP`              | e.g. `cognia-share` / `-staging`                       |

Give `production` protection rules (required reviewers) under Settings →
Environments. One-time provisioning (R2 bucket, KV namespace, D1 databases,
Worker secrets, Fly volumes) is in each service's README.

The status page is part of the app's static export. The status deploy builds
it from the app revision pinned in `integrations/cognia-next.json`, so a
status UI change ships by bumping that pin. The update and Logto mail Workers
deploy by hand with `pnpm exec wrangler deploy` (see their READMEs).

## Licence

AGPL-3.0, the same as the app. See [LICENSE](LICENSE).
