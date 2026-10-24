// The diagnostics stack builds MinIO server and client from pinned official
// sources: the community registry images were retired, and an unpinned
// `go install …@latest` would make every build a different binary.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8")

/** The indented block of one top-level compose service, up to the next one. */
function serviceBlock(compose, name) {
  const match = new RegExp(`^  ${name}:\\n((?:(?:    .*)?\\n)+)`, "m").exec(compose)
  assert.ok(match, `compose.yaml declares ${name}`)
  return match[1]
}

test("diagnostics builds MinIO server and client from pinned official sources", () => {
  const compose = read("compose.yaml")
  for (const [name, target] of [
    ["minio", "server"],
    ["minio-init", "client"],
  ]) {
    const block = serviceBlock(compose, name)
    assert.doesNotMatch(block, /^    image:/m, `${name} must not pull a registry image`)
    assert.match(block, /^    build:\n      context: \.\n/m)
    assert.match(block, /^      dockerfile: Dockerfile\.minio$/m)
    assert.match(block, new RegExp(`^      target: ${target}$`, "m"))
  }
  const dockerfile = read("Dockerfile.minio")
  assert.match(dockerfile, /MINIO_VERSION=v0\.0\.0-20251015172955-9e49d5e7a648/)
  assert.match(dockerfile, /MC_VERSION=v0\.0\.0-20250813083541-7394ce0dd2a8/)
  assert.match(dockerfile, /github\.com\/minio\/minio@\$\{MINIO_VERSION\}/)
  assert.match(dockerfile, /github\.com\/minio\/mc@\$\{MC_VERSION\}/)
  assert.doesNotMatch(dockerfile, /@latest|GOSUMDB=off/)
})

test("the block reader stops at the next service", () => {
  const block = serviceBlock("services:\n  a:\n    image: x\n\n  b:\n    build: y\n", "a")
  assert.equal(block, "    image: x\n\n")
})
