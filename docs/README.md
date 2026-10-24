# Documentation

Start with the [repository README](../README.md) for the layout, then the README
of the service you are working on. This directory holds what spans services or
outlives one change.

| Document                                                                                                                 | What it covers                                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [contracts.md](contracts.md)                                                                                             | Every contract shared with the app, how the app pins and checks it, how to change one |
| [releasing.md](releasing.md)                                                                                             | Version tags, images, Worker deploys, rollback                                        |
| [adr/](adr/README.md)                                                                                                    | Copies of the decision records these services follow (English and Chinese)            |
| [protocols/account-sync-protocol.md](protocols/account-sync-protocol.md) ([中文](protocols/account-sync-protocol.zh.md)) | Account sync protocol v1, byte for byte                                               |
| [runbooks/sync-worker.md](runbooks/sync-worker.md)                                                                       | Incidents and maintenance for the account sync Worker                                 |
| [runbooks/identity-worker.md](runbooks/identity-worker.md)                                                               | Incidents and maintenance for the official account identity Worker                    |
| [plans/2026-10-02-signaling-public-status-implementation.md](plans/2026-10-02-signaling-public-status-implementation.md) | The public status service's implementation plan and handoff                           |

Per service:

| Service                                                  | Guides                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [signaling](../services/signaling-server/README.md)      | [Cloudflare Worker](../services/signaling-server/worker/README.md)                                                                          |
| [share](../services/share-server/README.md)              | [Worker API](../services/share-server/worker/README.md), [viewer on Pages](../services/share-server/pages/README.md)                        |
| [status](../services/status-server/README.md)            | [external probe and mirror](../services/status-server/probe/deploy/README.md)                                                               |
| [identity](../services/identity-server/README.md)        | [runbook](runbooks/identity-worker.md)                                                                                                      |
| [sync](../services/sync-server/README.md)                | [runbook](runbooks/sync-worker.md), [protocol](protocols/account-sync-protocol.md)                                                          |
| [update](../services/update-server/README.md)            | [Worker operator guide](../services/update-server/worker/README.md)                                                                         |
| [diagnostic](../services/diagnostic-server/README.md)    | [Helm chart](../services/diagnostic-server/deploy/helm/cognia-diagnostics/README.md), [OpenAPI](../services/diagnostic-server/openapi.yaml) |
| [Logto mail](../services/logto-email/README.md)          |                                                                                                                                             |
| [sync-protocol](../packages/sync-protocol/README.md)     | [protocol](protocols/account-sync-protocol.md)                                                                                              |
| [status-contract](../packages/status-contract/README.md) |                                                                                                                                             |

Documents moved here from cognia-next (the protocol spec, the runbooks, the
status plan) are maintained here; the app links to them. Paths in them that do
not start with `services/`, `packages/` or `docs/` refer to cognia-next.
