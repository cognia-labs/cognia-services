# Decision records

The decisions these services follow were made in the app repository,
[cognia-next](https://github.com/MaxQian888/cognia-next/tree/dev/docs/content/docs/en/adr),
and are copied here in English (`en/`) and Chinese (`zh/`) so the reasoning sits
beside the code it governs. The app repository keeps the record: a decision is
amended or superseded there first, then the copy here is refreshed in the same
change that adapts the services.

Paths in a record that do not start with `services/`, `packages/` or `docs/`
refer to cognia-next.

本目录是 cognia-next 中相关架构决策记录（ADR）的中英文副本。决策以应用仓库为准：
修订或废止先在应用仓库进行，再在调整服务的同一次变更中刷新这里的副本。

| ADR  | Decision                                                            | Services                      | English                                                                  | 中文                                                                     |
| ---- | ------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 0021 | WebRTC DataChannel WAN transport                                    | signaling                     | [en](en/0021-webrtc-datachannel-wan-transport.md)                        | [zh](zh/0021-webrtc-datachannel-wan-transport.md)                        |
| 0037 | Public share links (zero-knowledge)                                 | share                         | [en](en/0037-public-share-links.md)                                      | [zh](zh/0037-public-share-links.md)                                      |
| 0102 | Unified observability and crash diagnostics                         | diagnostic                    | [en](en/0102-unified-observability-crash-diagnostics.md)                 | [zh](zh/0102-unified-observability-crash-diagnostics.md)                 |
| 0135 | Diagnostic service completion                                       | diagnostic                    | [en](en/0135-diagnostic-service-completion.md)                           | [zh](zh/0135-diagnostic-service-completion.md)                           |
| 0149 | A person is not a device (identity plane, tenant grants)            | share, diagnostic             | [en](en/0149-a-person-is-not-a-device.md)                                | [zh](zh/0149-a-person-is-not-a-device.md)                                |
| 0170 | The relay is the WAN, and connectivity is one surface               | signaling, status-contract    | [en](en/0170-cognia-relay-and-connectivity-center.md)                    | [zh](zh/0170-cognia-relay-and-connectivity-center.md)                    |
| 0211 | The public status page measures the relay it names                  | status, status-contract       | [en](en/0211-public-status-measures-the-relay-it-names.md)               | [zh](zh/0211-public-status-measures-the-relay-it-names.md)               |
| 0215 | One person, one encrypted sync space, many writable hosts           | identity, sync, sync-protocol | [en](en/0215-one-person-one-encrypted-sync-space-many-writable-hosts.md) | [zh](zh/0215-one-person-one-encrypted-sync-space-many-writable-hosts.md) |
| 0224 | An always-on host is a peer the user brings (signed update catalog) | update                        | [en](en/0224-an-always-on-host-is-a-peer-the-user-brings.md)             | [zh](zh/0224-an-always-on-host-is-a-peer-the-user-brings.md)             |

Other records cited from these (for example ADR-0059 for the cloud deployment
and ADR-0092 for static public sites) are linked to the app repository.

## Refreshing a copy

Copy the record from `docs/content/docs/<lang>/adr/` in cognia-next, drop the
front matter, keep the note under the title, and turn relative links into links
to this directory (for copied records) or to the app repository on GitHub.
`node scripts/check-docs.mjs` fails on any link that does not resolve.
