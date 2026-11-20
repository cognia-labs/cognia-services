/**
 * Writes fixtures/v1-settings.json: frozen vectors for settings virtual rows
 * merged by property (protocol §7.2, §9): the field names and the merge
 * outcomes, including whole values from a device on an older schema.
 *
 * Kept apart from v1-ops.json so adding these did not regenerate (and so
 * change) the op-log vectors. The same rule holds: do NOT rerun this to make a
 * failing test pass; a mismatch means the settings encoding changed.
 *
 *   pnpm fixtures:generate:settings   (inside packages/sync-protocol)
 */

// static-export-exempt: manual Node fixture writer, outside package src exports and app imports.
import { writeFileSync } from "node:fs"
import path from "node:path" // static-export-exempt: manual Node fixture writer resolves its output path; not shipped to clients.
import { fileURLToPath } from "node:url" // static-export-exempt: manual Node fixture writer locates its script directory; not shipped to clients.

import { encodeHlc } from "../src/hlc"
import type { RowClocks } from "../src/merge"
import type { ClockedValue } from "../src/ops"
import { mergeSettingProperties, settingsPropertyField, settingsPropertyOf } from "../src/settings"

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "v1-settings.json"
)

// Fixed ids, so the file only changes when the encoding does.
const lo = "dev_0EFX1ZYAQCMYW42HRKG4F15V6W"
const hi = "dev_7ZEWAM8BBBAF70YKNJZCYKARF8"
const t = (ms: number, deviceId = lo) => encodeHlc({ ms, c: 0, deviceId })
const p = settingsPropertyField

function main() {
  const fields = {
    named: ["displayName", "a.b"].map((property) => ({ property, field: p(property) })),
    read: ["value", "value.", "value.bio", "other"].map((field) => ({
      field,
      property: settingsPropertyOf(field),
    })),
  }

  const cases: {
    name: string
    current?: Record<string, unknown>
    clocks?: RowClocks
    incoming: Record<string, ClockedValue>
  }[] = [
    {
      name: "different properties both keep their change",
      current: { displayName: "Ada", bio: "old" },
      clocks: { fields: { value: t(1) } },
      incoming: { [p("bio")]: ["new bio", t(5, hi)] },
    },
    {
      name: "an older write of a property loses",
      current: { bio: "mine" },
      clocks: { fields: { [p("bio")]: t(6) } },
      incoming: { [p("bio")]: ["theirs", t(5, hi)] },
    },
    {
      name: "null removes a property",
      current: { bio: "x", displayName: "Ada" },
      incoming: { [p("bio")]: [null, t(2)] },
    },
    {
      name: "a whole value from an older schema writes every property but newer ones",
      current: { displayName: "Ada", bio: "mine", avatar: "a.png" },
      clocks: { fields: { value: t(1), [p("bio")]: t(9) } },
      incoming: { value: [{ displayName: "Grace", bio: "theirs" }, t(5, hi)] },
    },
    {
      name: "a property older than the whole-write clock loses even when unknown",
      current: { displayName: "Grace" },
      clocks: { fields: { value: t(5) } },
      incoming: { [p("bio")]: ["late", t(3, hi)] },
    },
    {
      name: "a null whole value clears the key but keeps newer properties",
      current: { bio: "x", displayName: "Ada" },
      clocks: { fields: { [p("bio")]: t(2), [p("displayName")]: t(8) } },
      incoming: { value: [null, t(5)] },
    },
    {
      name: "a key with no property left is absent",
      current: { bio: "x" },
      clocks: { fields: { [p("bio")]: t(2) } },
      incoming: { value: [null, t(5)] },
    },
    {
      name: "a stored whole-value clock is every property's clock",
      current: { bio: "mine" },
      clocks: { fields: { value: t(4) } },
      incoming: { [p("bio")]: ["newer", t(4, hi)] },
    },
    {
      name: "a whole value that is not an object removes every property",
      current: { bio: "x" },
      clocks: { fields: { [p("bio")]: t(2) } },
      incoming: { value: ["dark", t(3)] },
    },
    {
      name: "the tombstone and other fields are left alone",
      clocks: { fields: {}, tombstone: t(1) },
      incoming: { value: [{ bio: "x" }, t(3)], other: [1, t(9)] },
    },
  ]
  const merge = cases.map((input) => ({
    ...input,
    expected: mergeSettingProperties(input.current, input.clocks, input.incoming),
  }))

  const fixtures = {
    "//": "Account Sync Protocol v1 settings vectors. Frozen: never regenerate to fix a test (see scripts/generate-settings-fixtures.ts).",
    fields,
    merge,
  }
  writeFileSync(OUT, JSON.stringify(fixtures, null, 2) + "\n")
  console.log(`wrote ${OUT}`)
}

main()
