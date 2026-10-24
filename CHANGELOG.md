# Changelog

Versions tag the container images (`ghcr.io/cognia-labs/cognia-{signaling,share,diagnostics}`).
Workers deploy on their own; the app pins commits, not versions. See
[docs/releasing.md](docs/releasing.md).

## Unreleased

- diagnostic-server: `POST /v1/incidents/{id}/delete-with-credential` deletes an
  incident with its one-time deletion credential and no grant. The credential
  was minted and stored before but never checked, so a reinstall or a lost
  installation key stranded earlier submissions.
- diagnostic-server: the `crash_spike`, `upload_failure`, `storage_failure` and
  `processing_backlog` alerts are raised (they existed in the schema only), at
  most once per project or group per window. New settings:
  `ALERT_DEDUPE_WINDOW_SECONDS`, `ALERT_SPIKE_*`, `ALERT_BACKLOG_*`.
- diagnostic-server: alerts are queued only on configured transports (webhook,
  SMTP, OTel) instead of all three, which left a permanently failed delivery
  per alert for every unconfigured one. A partial SMTP setup now refuses to
  start. Migration `0007_alert_windows.sql` adds two indexes.
- diagnostic-server: clippy runs in CI (the unused `clap` dependency and two
  deprecated nonce calls are gone), and the repository's SQL is tested against
  PostgreSQL.

## 0.1.0 — 2026-10-24

First release after the services moved out of
[cognia-next](https://github.com/MaxQian888/cognia-next) with their history.

- Services: signaling (axum + Cloudflare Worker), share (axum + Worker), public
  status (Worker + D1, external probe, operator CLI), official account identity
  (Worker + D1), account sync (Worker + Durable Objects), update catalog
  (Worker + D1), diagnostics (axum + Postgres), Logto mail connector (Worker).
- Contracts owned here and consumed by the app at a pinned commit:
  `cognia-signaling-core`, `@cognia/sync-protocol`, and the new
  `@cognia/status-contract` package (the status v1 contract and relay health,
  formerly `lib/status/` in the app).
- Every service builds, tests and deploys from this repository: one workflow per
  service, `images.yml` for the three images, `deploy.yml` for Workers and Fly.io.
- The share server's blob-write guard returns a boxed response (clippy
  `result_large_err`); the sync Worker type-checks its config file on its own.
- Documentation: per-service READMEs (now including diagnostics, update and both
  contract packages), contract and release guides, copies of the decision
  records, and the sync protocol spec and runbooks moved from the app.
- Repository tooling: `node scripts/each.mjs <task>` runs a task across every
  unit; `node scripts/check-docs.mjs` checks every Markdown link.
