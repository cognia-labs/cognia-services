import { defineConfig } from "vitest/config"

// The suites were written against Jest's globals in the app repository.
export default defineConfig({
  test: { globals: true, include: ["src/**/*.test.ts"] },
})
