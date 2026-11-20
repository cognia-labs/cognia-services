/**
 * Settings virtual rows (protocol §7.2, §9).
 *
 * Settings travel as one virtual row per key, `t: "settings", id: <key>`.
 * The client's sync schema decides, per key, how the key merges:
 *
 * - **Whole value** (the default): the value travels in field `value` and the
 *   later write of the whole value wins (`mergeUpsert`).
 * - **By property**, for a key whose value is an object of independent
 *   preferences: each changed property travels in its own field
 *   `value.<property>`, and `[null, hlc]` removes the property. Two devices
 *   that change different properties at the same time both keep their change.
 *
 * In a key merged by property, `value` still means a write of the whole
 * object: every property it holds is set and every other property is removed,
 * as of its clock. The clock of the latest such write is kept as the key's
 * `value` clock and is the clock of every property that has none of its own.
 * That makes three things hold:
 *
 * - The outcome does not depend on the order ops arrive in. A property write
 *   older than a whole write loses to it even when the property was unknown
 *   when the whole write was applied.
 * - An op from a device on an older schema, which writes the whole object in
 *   `value`, merges with property writes without losing either side's newer
 *   change.
 * - The `value` clocks a device stored before the key merged by property need
 *   no migration: they become the key's whole-write clock.
 *
 * A writer clears a key merged by property with a write of `value`. Whenever it
 * sends `value`, it carries the properties that have no clock of their own
 * (`null` when there are none, as right after a clear): a whole write from
 * another device may have landed between the clear and the push, and a `null`
 * at that clock would remove its properties on a device it has not reached
 * yet, which would then ignore the write itself as a tie. A key with no
 * property left is absent, so the app's default applies.
 *
 * Pure: the caller reads the key's value and clocks, applies the result and
 * stores the clocks in the same transaction.
 */

import type { RowClocks } from "./merge"
import type { ClockedValue } from "./ops"

/** The table name of settings virtual rows. */
export const SETTINGS_TABLE = "settings"
/** The field holding a whole settings value. */
export const SETTINGS_VALUE_FIELD = "value"
/** Fields `value.<property>` carry one property of a key merged by property. */
export const SETTINGS_PROPERTY_PREFIX = "value."

/** The field one property of a key merged by property travels in. */
export function settingsPropertyField(property: string): string {
  if (property.length === 0) throw new Error("a settings property needs a name")
  return SETTINGS_PROPERTY_PREFIX + property
}

/** The property a field names, or `null` for `value` and any other field. */
export function settingsPropertyOf(field: string): string | null {
  if (!field.startsWith(SETTINGS_PROPERTY_PREFIX)) return null
  const property = field.slice(SETTINGS_PROPERTY_PREFIX.length)
  return property.length > 0 ? property : null
}

export type SettingPropertiesMergeResult =
  | { kind: "ignore" }
  | {
      kind: "write"
      /** The key's new value; `undefined` when no property is left. */
      value: Record<string, unknown> | undefined
      clocks: RowClocks
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A property's value and the clock it was written at (`undefined` = absent). */
interface Candidate {
  present: boolean
  value: unknown
  hlc: string | undefined
}

function later(a: Candidate, b: Candidate): Candidate {
  if (b.hlc === undefined) return a
  if (a.hlc === undefined) return b
  return b.hlc > a.hlc ? b : a
}

/**
 * Merges one op's settings fields into a key merged by property.
 *
 * `current` is the key's value on this device, `clocks` its stored clocks,
 * `incoming` the op's `f`. Fields other than `value` and `value.<property>`
 * are not settings fields and are left out.
 */
export function mergeSettingProperties(
  current: unknown,
  clocks: RowClocks | undefined,
  incoming: Record<string, ClockedValue>
): SettingPropertiesMergeResult {
  const held = isRecord(current) ? current : {}
  const heldClocks = clocks?.fields ?? {}
  const floor: string | undefined = heldClocks[SETTINGS_VALUE_FIELD]

  const whole = incoming[SETTINGS_VALUE_FIELD]
  const wholeHlc = whole?.[1]
  // A whole value that is not an object holds no property: it removes them all.
  const wholeValue = whole && isRecord(whole[0]) ? whole[0] : {}

  const writes = new Map<string, ClockedValue>()
  for (const [field, entry] of Object.entries(incoming)) {
    const property = settingsPropertyOf(field)
    if (property !== null) writes.set(property, entry)
  }

  const properties = new Set<string>([
    ...Object.keys(held),
    ...Object.keys(wholeValue),
    ...writes.keys(),
  ])
  for (const field of Object.keys(heldClocks)) {
    const property = settingsPropertyOf(field)
    if (property !== null) properties.add(property)
  }

  const nextFloor =
    wholeHlc !== undefined && (floor === undefined || wholeHlc > floor) ? wholeHlc : floor
  // Entries, not assignment: a property named `__proto__` must stay a property.
  const entries: [string, unknown][] = []
  const fieldClocks: Record<string, string> = {}
  if (nextFloor !== undefined) fieldClocks[SETTINGS_VALUE_FIELD] = nextFloor
  let changed = nextFloor !== floor

  for (const property of [...properties].sort()) {
    const field = settingsPropertyField(property)
    const own = heldClocks[field]
    const local: Candidate = {
      present: Object.hasOwn(held, property),
      value: held[property],
      hlc: own ?? floor,
    }
    let winner = local
    if (wholeHlc !== undefined) {
      winner = later(winner, {
        present: Object.hasOwn(wholeValue, property) && wholeValue[property] !== null,
        value: wholeValue[property],
        hlc: wholeHlc,
      })
    }
    const write = writes.get(property)
    if (write) {
      winner = later(winner, { present: write[0] !== null, value: write[0], hlc: write[1] })
    }
    if (winner !== local) changed = true
    if (winner.present) entries.push([property, winner.value])
    // A property keeps a clock of its own only while it is newer than the
    // key's whole-write clock; otherwise that clock stands for it.
    if (winner.hlc !== undefined && (nextFloor === undefined || winner.hlc > nextFloor))
      fieldClocks[field] = winner.hlc
  }

  if (!changed) return { kind: "ignore" }
  const result: RowClocks =
    clocks?.tombstone === undefined
      ? { fields: fieldClocks }
      : { fields: fieldClocks, tombstone: clocks.tombstone }
  return {
    kind: "write",
    value: entries.length > 0 ? Object.fromEntries(entries) : undefined,
    clocks: result,
  }
}
