#!/usr/bin/env node
/**
 * Documentation checks for this repository:
 *   - every relative Markdown link in a tracked (or new, unignored) .md file
 *     resolves to such a file or directory, and a `#fragment` names a heading in the target;
 *   - the root README lists every service and package directory.
 *
 * Links into the app repository must be absolute GitHub URLs; a relative path
 * left over from before the split fails here.
 *
 *   node scripts/check-docs.mjs
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** GitHub's heading anchor: lower-case, punctuation dropped, spaces to dashes. */
export function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/`/g, "")
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]/gu, "")
    .replace(/\s/g, "-")
}

/** Anchors a Markdown document defines, with GitHub's `-1`, `-2` suffixes for repeats. */
export function anchors(markdown) {
  const seen = new Map()
  const result = new Set()
  let fenced = false
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (fenced) continue
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) continue
    const base = slug(match[1].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"))
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    result.add(count ? `${base}-${count}` : base)
  }
  for (const match of markdown.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) result.add(match[1])
  return result
}

/** Relative link targets in a Markdown document, skipping code. */
export function links(markdown) {
  const found = []
  let fenced = false
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (fenced) continue
    const prose = line.replace(/`[^`]*`/g, "")
    for (const match of prose.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
      const target = match[1]
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue
      found.push(target)
    }
  }
  return found
}

/** Problems with the links in `files` (repository-relative paths) against `tracked`. */
export function linkProblems(files, tracked, read) {
  const trackedSet = new Set(tracked)
  const directories = new Set()
  for (const path of tracked) {
    let dir = dirname(path)
    while (dir !== ".") {
      directories.add(dir)
      dir = dirname(dir)
    }
  }
  const problems = []
  for (const file of files) {
    const text = read(file)
    for (const target of links(text)) {
      const [path, fragment] = target.split("#")
      const resolved = path
        ? normalize(join(dirname(file), decodeURI(path))).replace(/\/$/, "")
        : file
      if (resolved.startsWith("..")) {
        problems.push(`${file}: ${target} leaves the repository; link the app with a GitHub URL`)
        continue
      }
      if (!trackedSet.has(resolved) && !directories.has(resolved)) {
        problems.push(`${file}: ${target} does not exist`)
        continue
      }
      if (fragment && resolved.endsWith(".md") && !anchors(read(resolved)).has(fragment))
        problems.push(`${file}: ${target} names no heading in ${resolved}`)
    }
  }
  return problems
}

/** Service and package directories the root README does not mention. */
export function readmeProblems(readme, tracked) {
  const units = new Set()
  for (const path of tracked) {
    const match = /^(services|packages)\/([^/]+)\//.exec(path)
    if (match) units.add(`${match[1]}/${match[2]}`)
  }
  return [...units]
    .filter((unit) => !readme.includes(`\`${unit}\``))
    .map((unit) => `README.md does not list \`${unit}\``)
}

function main() {
  const tracked = execFileSync(
    "git",
    ["-C", ROOT, "ls-files", "--cached", "--others", "--exclude-standard"],
    {
      encoding: "utf8",
    }
  )
    .split("\n")
    .filter(Boolean)
  const read = (path) => readFileSync(join(ROOT, path), "utf8")
  const markdown = tracked.filter((path) => path.endsWith(".md"))
  const problems = [
    ...linkProblems(markdown, tracked, read),
    ...readmeProblems(read("README.md"), tracked),
  ]
  for (const problem of problems) console.error(`✗ ${problem}`)
  if (problems.length) return 1
  console.log(`docs: ${markdown.length} Markdown files, every relative link resolves`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exit(main())
