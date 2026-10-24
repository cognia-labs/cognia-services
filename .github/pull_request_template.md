## What and why

<!-- What changes, and why. Link the issue if there is one (Closes #…). -->

## Services touched

<!-- Tick every unit this changes. -->

- [ ] signaling-server (incl. `core/` crate or Worker)
- [ ] share-server (server, Worker or Pages viewer)
- [ ] status-server (Worker, probe or admin)
- [ ] identity-server
- [ ] sync-server
- [ ] update-server
- [ ] diagnostic-server
- [ ] logto-email
- [ ] packages/sync-protocol
- [ ] packages/status-contract
- [ ] CI, tooling or docs only

## Contract impact

<!-- docs/contracts.md lists what the app consumes. -->

- [ ] No shared contract changes
- [ ] A shared contract changes; the app needs a pin bump (describe the follow-up and whether the change is wire-compatible)

## Testing

<!-- Commands you ran and their result, e.g. `pnpm test` in services/sync-server. -->

## Checklist

- [ ] Tests cover the change
- [ ] Service README / docs updated where configuration, routes or operations change (`node scripts/check-docs.mjs` passes)
- [ ] No applied migration edited; new migrations are new files
- [ ] `CHANGELOG.md` updated under `## Unreleased` for user-visible changes
- [ ] Deploy notes: new secrets, variables or one-time provisioning are documented
