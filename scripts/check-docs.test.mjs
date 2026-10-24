import assert from "node:assert/strict"
import test from "node:test"

import { anchors, linkProblems, links, readmeProblems, slug } from "./check-docs.mjs"

test("anchors follow GitHub's slugs, including repeats and CJK headings", () => {
  assert.equal(slug("Deploy (operator, once)"), "deploy-operator-once")
  assert.equal(slug("`wrangler` & D1"), "wrangler--d1")
  const found = anchors("# Title\n## Run\n```\n## not a heading\n```\n## Run\n## 部署与回滚\n")
  assert.deepEqual([...found], ["title", "run", "run-1", "部署与回滚"])
})

test("links skip code, external URLs and mail addresses", () => {
  const text = [
    "[a](docs/a.md) and `[b](not-a-link.md)`",
    "```",
    "[c](inside-a-fence.md)",
    "```",
    "[d](https://example.com) [e](mailto:x@example.com) [f](#local)",
  ].join("\n")
  assert.deepEqual(links(text), ["docs/a.md", "#local"])
})

test("broken, escaping and dangling-fragment links are reported", () => {
  const files = {
    "README.md": "[ok](docs/guide.md#setup) [dir](services/) [gone](docs/missing.md)",
    "docs/guide.md": "# Guide\n## Setup\n[app](../../lib/x.ts) [bad](#nowhere) [up](../README.md)",
  }
  const tracked = [...Object.keys(files), "services/a/x"]
  const problems = linkProblems(Object.keys(files), tracked, (path) => files[path])
  assert.deepEqual(problems, [
    "README.md: docs/missing.md does not exist",
    "docs/guide.md: ../../lib/x.ts leaves the repository; link the app with a GitHub URL",
    "docs/guide.md: #nowhere names no heading in docs/guide.md",
  ])
})

test("the root README must name every service and package directory", () => {
  const tracked = ["services/a/x", "services/b/y", "packages/c/z", "docs/x.md"]
  assert.deepEqual(readmeProblems("`services/a` and `packages/c`", tracked), [
    "README.md does not list `services/b`",
  ])
})
