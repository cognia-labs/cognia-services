import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

// The edge routes in front of the self-hosted relay (Caddy, Kubernetes ingress)
// live with the app's deployment bundle and are pinned there.
test("production signaling explicitly admits both bundled mobile origins", () => {
  const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8")
  const origins = config.match(/^SIGNALING_ALLOWED_ORIGINS = "([^"]*)"/m)?.[1].split(",")
  assert.ok(origins, "production origin allowlist exists")
  for (const origin of ["https://cognia.cn", "capacitor://localhost", "https://localhost"]) {
    assert.ok(origins.includes(origin), `missing shipped app origin: ${origin}`)
  }
  assert.ok(!origins.includes("*"))
  assert.ok(!origins.includes("null"))
})
