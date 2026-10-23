# Cognia services

The cloud and self-hosted services behind [Cognia](https://github.com/MaxQian888/cognia-next),
and the wire contracts they share with the app. Every service builds, tests and
deploys on its own: its own lockfile, its own CI lane, its own image or Worker.

Cognia 的云端与自托管服务，以及它们和应用共享的协议契约。每个服务都可以独立构建、测试与部署。

| Path                         | What                                                                  | Stack                          |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| `services/signaling-server`  | WebRTC signaling relay (ADR-0021); `core/` is the shared wire crate   | Rust axum + Cloudflare Worker  |
| `services/share-server`      | Public share links (ADR-0037)                                         | Rust axum + Cloudflare Worker  |
| `services/status-server`     | Public status page backend, external probe, operator CLI (ADR-0211)   | Cloudflare Worker + D1, Node   |
| `services/identity-server`   | Official Cognia account OIDC issuer (ADR-0215)                        | Cloudflare Worker + D1         |
| `services/sync-server`       | Account sync device registry and op log (ADR-0215)                    | Cloudflare Worker + Durable Objects |
| `services/update-server`     | Signed update catalog storage (ADR-0224)                              | Cloudflare Worker + D1         |
| `services/diagnostic-server` | Diagnostic reports and crash symbolication (ADR-0102, ADR-0135)       | Rust axum + Postgres           |
| `services/logto-email`       | Logto HTTP email connector → Cloudflare Email Sending                 | Cloudflare Worker              |
| `packages/sync-protocol`     | `@cognia/sync-protocol`: account sync protocol v1                     | TypeScript, dependency-free    |

ADR numbers refer to the decision records in the app repository
(`docs/content/docs/en/adr/`).

## Building a service

Each service's README has the full commands. In short:

```bash
# Rust services
cargo test --manifest-path services/signaling-server/Cargo.toml
# Workers (Node 26, pnpm 11; run inside the service directory)
pnpm install --frozen-lockfile && pnpm test
```

## Contracts shared with the app

This repository owns the wire contracts the app consumes. The app pins one
commit of this repository (`integrations/cognia-services.json` in the app
repository) and uses that same revision for the `cognia-signaling-core` Cargo
dependency and the `@cognia/*` packages. A contract change lands here first;
the app follows with a pin bump.

## Licence

AGPL-3.0, the same as the app. See [LICENSE](LICENSE).
