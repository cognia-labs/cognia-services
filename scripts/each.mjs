#!/usr/bin/env node
/**
 * Runs one task across every buildable unit in this repository. Each unit
 * keeps its own lockfile and toolchain, so this script only walks them in
 * order and reports which ones failed; CI still runs each unit in its own
 * workflow.
 *
 *   node scripts/each.mjs <task> [--only <name>[,<name>…]] [--fail-fast]
 *   node scripts/each.mjs --list
 *
 * Tasks: install, typecheck, lint, test, build.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export const TASKS = ["install", "typecheck", "lint", "test", "build"]

const WASM = ["--target", "wasm32-unknown-unknown"]

/**
 * Every pnpm root and Cargo workspace, in dependency order: the contract
 * packages first, and the status probe before the status Worker (whose
 * postinstall installs the probe it imports).
 */
export const UNITS = [
  { name: "status-contract", dir: "packages/status-contract", kind: "pnpm" },
  { name: "sync-protocol", dir: "packages/sync-protocol", kind: "pnpm" },
  { name: "signaling", dir: "services/signaling-server", kind: "cargo" },
  { name: "signaling-worker", dir: "services/signaling-server/worker", kind: "cargo-wasm" },
  { name: "share", dir: "services/share-server", kind: "cargo" },
  { name: "share-worker", dir: "services/share-server/worker", kind: "pnpm" },
  { name: "diagnostic", dir: "services/diagnostic-server", kind: "cargo" },
  { name: "status-probe", dir: "services/status-server/probe", kind: "pnpm" },
  { name: "status-admin", dir: "services/status-server/admin", kind: "pnpm" },
  { name: "status-worker", dir: "services/status-server/worker", kind: "pnpm" },
  { name: "identity", dir: "services/identity-server", kind: "pnpm" },
  { name: "sync", dir: "services/sync-server", kind: "pnpm" },
  { name: "update-worker", dir: "services/update-server/worker", kind: "pnpm" },
  { name: "logto-email", dir: "services/logto-email", kind: "pnpm" },
]

/**
 * The command a unit runs for a task, or a reason it has none.
 * @returns {{ command: string[] } | { skip: string }}
 */
export function commandFor(unit, task, root = ROOT) {
  if (unit.kind === "pnpm") {
    if (task === "install") return { command: ["pnpm", "install", "--frozen-lockfile"] }
    const scripts = JSON.parse(readFileSync(join(root, unit.dir, "package.json"), "utf8")).scripts
    if (!scripts?.[task]) return { skip: `no "${task}" script` }
    return { command: ["pnpm", "run", task] }
  }
  const wasm = unit.kind === "cargo-wasm"
  switch (task) {
    case "install":
      return { command: ["cargo", "fetch", "--locked"] }
    case "typecheck":
      return {
        command: wasm
          ? ["cargo", "check", "--locked", ...WASM]
          : ["cargo", "check", "--locked", "--workspace", "--all-targets"],
      }
    case "lint":
      return {
        command: wasm
          ? ["cargo", "clippy", "--locked", ...WASM, "--", "-D", "warnings"]
          : ["cargo", "clippy", "--locked", "--workspace", "--all-targets", "--", "-D", "warnings"],
      }
    case "test":
      if (wasm)
        return { skip: "wasm-only crate; its logic is tested in services/signaling-server/core" }
      return { command: ["cargo", "test", "--locked", "--workspace"] }
    case "build":
      if (wasm) return { skip: "built by worker-build at deploy time (see the signaling workflow)" }
      return { command: ["cargo", "build", "--locked", "--release"] }
    default:
      throw new Error(`unknown task ${task}`)
  }
}

/** Units selected by `--only` (names or directory prefixes). */
export function select(units, only) {
  if (!only) return units
  const wanted = only.split(",").filter(Boolean)
  const picked = units.filter((unit) =>
    wanted.some(
      (want) => unit.name === want || unit.dir === want || unit.dir.startsWith(`${want}/`)
    )
  )
  const unknown = wanted.filter(
    (want) =>
      !units.some(
        (unit) => unit.name === want || unit.dir === want || unit.dir.startsWith(`${want}/`)
      )
  )
  if (unknown.length) throw new Error(`unknown unit(s): ${unknown.join(", ")}`)
  return picked
}

/** Runs `task` over `units`; returns the names that failed. */
export function runAll(
  task,
  units,
  { failFast = false, root = ROOT, spawn = spawnSync, log = console.log } = {}
) {
  const failed = []
  for (const unit of units) {
    const planned = commandFor(unit, task, root)
    if ("skip" in planned) {
      log(`\n— ${unit.name}: skipped (${planned.skip})`)
      continue
    }
    const [bin, ...args] = planned.command
    log(`\n▶ ${unit.name} (${unit.dir}): ${planned.command.join(" ")}`)
    const result = spawn(bin, args, { cwd: join(root, unit.dir), stdio: "inherit" })
    if (result.status !== 0) {
      failed.push(unit.name)
      if (failFast) break
    }
  }
  return failed
}

function main(argv) {
  if (argv.includes("--list")) {
    for (const unit of UNITS)
      console.log(`${unit.name.padEnd(18)} ${unit.kind.padEnd(10)} ${unit.dir}`)
    return 0
  }
  const task = argv[0]
  if (!TASKS.includes(task)) {
    console.error(
      `usage: node scripts/each.mjs <${TASKS.join("|")}> [--only a,b] [--fail-fast] | --list`
    )
    return 2
  }
  const onlyIndex = argv.indexOf("--only")
  const units = select(UNITS, onlyIndex === -1 ? undefined : argv[onlyIndex + 1])
  for (const unit of units)
    if (!existsSync(join(ROOT, unit.dir))) throw new Error(`${unit.dir} does not exist`)
  const failed = runAll(task, units, { failFast: argv.includes("--fail-fast") })
  if (failed.length) {
    console.error(`\n✗ ${task} failed in: ${failed.join(", ")}`)
    return 1
  }
  console.log(`\n✓ ${task} passed in ${units.length} unit(s)`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exit(main(process.argv.slice(2)))
