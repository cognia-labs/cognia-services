import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

import { ROOT, UNITS, commandFor, runAll, select } from "./each.mjs"

const tracked = execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8" }).split("\n")

test("every pnpm root and Cargo workspace in the repository is a unit", () => {
  const pnpmRoots = tracked
    .filter((path) => path.endsWith("/pnpm-lock.yaml"))
    .map((path) => dirname(path))
  const cargoRoots = tracked
    .filter((path) => path.endsWith("/Cargo.lock"))
    .map((path) => dirname(path))
  const units = new Set(UNITS.map((unit) => unit.dir))
  for (const dir of [...pnpmRoots, ...cargoRoots])
    assert.ok(units.has(dir), `${dir} is missing from UNITS`)
  for (const unit of UNITS) {
    const marker = unit.kind === "pnpm" ? "pnpm-lock.yaml" : "Cargo.toml"
    assert.ok(tracked.includes(`${unit.dir}/${marker}`), `${unit.dir} has no ${marker}`)
  }
})

test("the status probe installs before the status Worker that imports it", () => {
  const order = UNITS.map((unit) => unit.name)
  assert.ok(order.indexOf("status-probe") < order.indexOf("status-worker"))
})

test("pnpm units run their own scripts and skip the ones they lack", () => {
  const root = mkdtempSync(join(tmpdir(), "each-"))
  try {
    mkdirSync(join(root, "pkg"))
    writeFileSync(join(root, "pkg/package.json"), JSON.stringify({ scripts: { test: "vitest" } }))
    const unit = { name: "pkg", dir: "pkg", kind: "pnpm" }
    assert.deepEqual(commandFor(unit, "test", root), { command: ["pnpm", "run", "test"] })
    assert.deepEqual(commandFor(unit, "install", root), {
      command: ["pnpm", "install", "--frozen-lockfile"],
    })
    assert.match(commandFor(unit, "build", root).skip, /no "build" script/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("cargo units are locked, and the wasm crate checks on its own target", () => {
  const native = { name: "n", dir: "n", kind: "cargo" }
  const wasm = { name: "w", dir: "w", kind: "cargo-wasm" }
  for (const task of ["install", "typecheck", "lint", "test", "build"])
    assert.ok(commandFor(native, task).command.includes("--locked"), task)
  assert.ok(commandFor(wasm, "typecheck").command.includes("wasm32-unknown-unknown"))
  assert.ok(commandFor(wasm, "lint").command.includes("wasm32-unknown-unknown"))
  assert.ok("skip" in commandFor(wasm, "test"))
})

test("--only takes names and directory prefixes and rejects unknown ones", () => {
  assert.deepEqual(
    select(UNITS, "sync,services/status-server").map((unit) => unit.name),
    ["status-probe", "status-admin", "status-worker", "sync"]
  )
  assert.throws(() => select(UNITS, "nope"), /unknown unit/)
  assert.equal(select(UNITS, undefined), UNITS)
})

test("failures are collected, and --fail-fast stops at the first", () => {
  const units = [
    { name: "a", dir: "a", kind: "cargo" },
    { name: "b", dir: "b", kind: "cargo" },
  ]
  const calls = []
  const spawn = (bin, args, { cwd }) => {
    calls.push(cwd)
    return { status: 1 }
  }
  const quiet = () => {}
  assert.deepEqual(runAll("test", units, { spawn, log: quiet, root: "/r" }), ["a", "b"])
  calls.length = 0
  assert.deepEqual(runAll("test", units, { spawn, log: quiet, root: "/r", failFast: true }), ["a"])
  assert.deepEqual(calls, ["/r/a"])
})
