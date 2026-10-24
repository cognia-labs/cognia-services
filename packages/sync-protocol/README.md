# @cognia/sync-protocol — account sync protocol v1

What the Cognia client and the sync Worker must agree on byte for byte
(ADR-0215,
[decision record](../../docs/adr/en/0215-one-person-one-encrypted-sync-space-many-writable-hosts.md)
copied from the app repository): canonical encoding, domain-separated hashing,
identifiers, the signed device registry and its rules, epoch keys and sealed
envelopes, the six-digit approval code, device proofs, and the encrypted op
log with its clocks, padding and merge.

The full specification is
[`docs/protocols/account-sync-protocol.md`](../../docs/protocols/account-sync-protocol.md).
It moved here from the app repository's
`docs/content/docs/en/data/account-sync-protocol.mdx` ([中文](../../docs/protocols/account-sync-protocol.zh.md)).
Section numbers (§) in the source refer to it.

It is source-only TypeScript with no runtime dependencies. There is no build
step: `exports` maps `.` to `src/index.ts` and `./*` to `src/*.ts`, and each
consumer bundles the source. Crypto is WebCrypto only, which browsers, Node,
Tauri and Capacitor webviews and Workers all provide. `src/zero-deps.test.ts`
fails if a module imports anything outside `src/` or the manifest gains a
dependency.

## Modules

Import from the root, which re-exports every module below except
`testing/chain`.

| Module                     | What it holds                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `bytes`                    | UTF-8, concatenation and base64url helpers shared by every module.                                                             |
| `labels`                   | `PROTOCOL_VERSION`, the `cognia-sync/v1/<label>` domain separation for every hash, signature and HKDF `info`.                  |
| `jcs`                      | RFC 8785 canonical JSON, the encoding of everything the protocol hashes or signs.                                              |
| `crypto`                   | The WebCrypto calls both sides need: SHA-256, HMAC, HKDF, AES-256-GCM, ECDSA P-256 over raw public points.                     |
| `crockford`                | Crockford base32 and the recovery key's display form, read back forgivingly.                                                   |
| `ids`                      | Device and request ids (`dev_…`, `req_…`) and `spaceIdFor(issuer, subject)`.                                                   |
| `limits`                   | The limits both sides enforce: devices, entry and batch sizes, request TTL and rate, proof skew, push size.                    |
| `errors`                   | The wire error codes and the registry's own failures.                                                                          |
| `epoch`                    | Epoch keys and subkeys, the key commitment, the wrap of the previous key, sealed device names.                                 |
| `envelopes`                | Associated data for epoch envelopes and sealed names, and the completeness check the Worker enforces.                          |
| `sas`                      | The commit-then-reveal approval code: commitment, transcript hash, six-digit code.                                             |
| `device-proof`             | The `Cognia-Device-Proof` header: create, parse and verify a signed request, ±120 s of the server clock.                       |
| `hlc`                      | Hybrid logical clocks: encoding (string order is clock order), compare, send and receive.                                      |
| `padding`                  | PADMÉ padding of an op's plaintext before encryption.                                                                          |
| `ops`                      | One encrypted, signed change to one row: canonical fields, AAD, op key, encrypt and decrypt, sign and verify, parse.           |
| `merge`                    | Per-field last-writer-wins by clock, with row-level deletes (`mergeUpsert`, `mergeDelete`).                                    |
| `registry/types`           | Registry entry and state types, device platforms.                                                                              |
| `registry/encode`          | `entryHash` and the bytes every entry signature covers.                                                                        |
| `registry/validate-append` | `validateAppend`, the one rule set the Worker and every client apply to each registry entry; `listActiveDevices`.              |
| `registry/fold`            | `foldRegistry`: verify a whole chain and derive its state. Every trusted public key comes out of this.                         |
| `registry/pin`             | The rollback pin a device keeps of the last chain it verified.                                                                 |
| `testing/chain`            | Test support: real keys and correctly signed chains. Not exported from the root; import `@cognia/sync-protocol/testing/chain`. |

## Frozen vectors

`fixtures/` pins the wire format. A failing vector means the format changed
and data already on a sync server would stop verifying, decrypting or
merging the same way. Fix the code, or ship protocol v2. Never regenerate a
v1 file to make a test pass.

| File               | Pins                                                                                                                                                                                 | Checked by                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `v1.json`          | Recovery key text, space ids, the approval code, epoch commit / wrap / sealed name, a device proof, and a signed registry chain with its expected hashes, head and invalid variants. | `src/fixtures.test.ts`    |
| `v1-ops.json`      | Clock encoding and order, padding buckets, the canonical field encoding, one sealed and signed op, and merge outcomes.                                                               | `src/op-fixtures.test.ts` |
| `jcs-vectors.json` | RFC 8785 golden vectors.                                                                                                                                                             | `src/jcs.test.ts`         |

Every implementation must pass them: this package in Node, the sync Worker
(its `src/protocol-parity.test.ts` runs `v1.json` and `v1-ops.json` inside
workerd), and any implementation that does not reuse this code, such as a future
port to Rust.

`jcs-vectors.json` is a copy. cognia-next keeps the original at
`lib/plugin/character-pack/__fixtures__/jcs-vectors.json` (character packs and
the CLI verify against it), and its pinned-services check compares the two
files' `vectors` lists, so both JCS implementations agree.

## Scripts

`scripts/` holds the writers that produced the frozen files. They exist so
the vectors are reproducible and reviewable, not to be rerun.

| Script                            | Command                      | Writes                 |
| --------------------------------- | ---------------------------- | ---------------------- |
| `scripts/generate-fixtures.ts`    | `pnpm fixtures:generate`     | `fixtures/v1.json`     |
| `scripts/generate-op-fixtures.ts` | `pnpm fixtures:generate:ops` | `fixtures/v1-ops.json` |

The op vectors live in their own file so adding them did not regenerate the
registry vectors. A new protocol version gets a new file.

## Consumers

| Consumer               | How it gets the package                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `services/sync-server` | `link:../../packages/sync-protocol`; its tests also use `@cognia/sync-protocol/testing/chain` |
| cognia-next, root      | pnpm git dependency at the revision pinned in `integrations/cognia-services.json`             |
| cognia-next, `cli/`    | the same git dependency, at the same revision                                                 |

The app installs

```
git+https://github.com/cognia-labs/cognia-services.git#<sha>&path:/packages/sync-protocol
```

where `<sha>` is the revision in its `integrations/cognia-services.json`. The
client side of account sync (`lib/account-sync/`) and the headless brain
(`cli/src/account-sync/`) import it. The app's pin check
(`scripts/ci/check-cognia-services.mjs`) fails when `package.json`,
`cli/package.json`, `pnpm-lock.yaml` or the Cargo files name a different
revision.

## Changing it

1. Change and test it here. A change that alters a frozen vector is a new
   protocol version, not a v1 edit.
2. Run the sync Worker's suite, which links this package. `sync-server.yml`
   reruns it on any change under `packages/sync-protocol/`.
3. Merge, then bump the app's pin in `integrations/cognia-services.json` and
   every other spelling of that revision its pin check lists (`package.json`,
   `cli/package.json`, `Cargo.toml` and both lockfiles).

## Develop

This package is its own pnpm root with its own lockfile. Use Node from the
repository's `.nvmrc` and the pnpm version in `package.json`.

```bash
cd packages/sync-protocol
pnpm install --frozen-lockfile
pnpm typecheck   # tsc --noEmit, over src/ and scripts/
pnpm test        # vitest run, frozen vectors included
```

`.github/workflows/contracts.yml` runs `pnpm typecheck` and `pnpm test` for
this package on every change under `packages/`.
