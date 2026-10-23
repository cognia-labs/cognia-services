import { defineConfig } from "vitest/config"

// The handlers are plain fetch/Durable Object code with every binding passed
// in, so the suites run in Node; scripts/runtime-smoke.mjs covers workerd.
export default defineConfig({
  test: { globals: true, environment: "node", include: ["*.test.ts"] },
})
