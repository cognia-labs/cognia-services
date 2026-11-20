import { encodeHlc } from "./hlc"
import type { RowClocks } from "./merge"
import type { ClockedValue } from "./ops"
import {
  SETTINGS_VALUE_FIELD,
  mergeSettingProperties,
  settingsPropertyField,
  settingsPropertyOf,
} from "./settings"

const A = "dev_" + "A".repeat(26)
const B = "dev_" + "B".repeat(26)
const at = (ms: number, deviceId = A) => encodeHlc({ ms, c: 0, deviceId })
const p = settingsPropertyField

describe("settings property fields", () => {
  it("names one property per field and reads it back", () => {
    expect(p("displayName")).toBe("value.displayName")
    expect(settingsPropertyOf("value.displayName")).toBe("displayName")
    // A property name may hold the separator itself.
    expect(settingsPropertyOf(p("a.b"))).toBe("a.b")
    expect(settingsPropertyOf(SETTINGS_VALUE_FIELD)).toBeNull()
    expect(settingsPropertyOf("value.")).toBeNull()
    expect(settingsPropertyOf("other")).toBeNull()
    expect(() => p("")).toThrow()
  })
})

describe("mergeSettingProperties", () => {
  it("keeps both devices' changes to different properties", () => {
    // The F4 case: one device renames, the other edits the bio, at once.
    const current = { displayName: "Ada", bio: "old" }
    const clocks: RowClocks = { fields: { [SETTINGS_VALUE_FIELD]: at(1) } }
    const local = mergeSettingProperties(current, clocks, { [p("bio")]: ["new bio", at(5, B)] })
    expect(local).toEqual({
      kind: "write",
      value: { displayName: "Ada", bio: "new bio" },
      clocks: { fields: { value: at(1), [p("bio")]: at(5, B) } },
    })
  })

  it("keeps the later write of one property", () => {
    const clocks: RowClocks = { fields: { [p("bio")]: at(6) } }
    expect(
      mergeSettingProperties({ bio: "mine" }, clocks, { [p("bio")]: ["theirs", at(5, B)] })
    ).toEqual({ kind: "ignore" })
    expect(
      mergeSettingProperties({ bio: "mine" }, clocks, { [p("bio")]: ["theirs", at(7, B)] })
    ).toMatchObject({ kind: "write", value: { bio: "theirs" } })
  })

  it("removes a property written as null", () => {
    expect(
      mergeSettingProperties({ bio: "x", displayName: "Ada" }, undefined, {
        [p("bio")]: [null, at(2)],
      })
    ).toEqual({
      kind: "write",
      value: { displayName: "Ada" },
      clocks: { fields: { [p("bio")]: at(2) } },
    })
  })

  it("reads an older schema's whole value as a write of every property", () => {
    // The other device still merges the key as a whole: what its object
    // holds is set and what it lacks is removed, as of its clock, except a
    // property this device changed later.
    const current = { displayName: "Ada", bio: "mine", avatar: "a.png" }
    const clocks: RowClocks = { fields: { value: at(1), [p("bio")]: at(9) } }
    expect(
      mergeSettingProperties(current, clocks, {
        value: [{ displayName: "Grace", bio: "theirs" }, at(5, B)],
      })
    ).toEqual({
      kind: "write",
      value: { displayName: "Grace", bio: "mine" },
      clocks: { fields: { value: at(5, B), [p("bio")]: at(9) } },
    })
  })

  it("lets a whole write beat an older property it never saw", () => {
    // The property arrives after the whole write that came later than it.
    const afterWhole = mergeSettingProperties(
      { displayName: "Grace" },
      { fields: { value: at(5) } },
      {
        [p("bio")]: ["late", at(3, B)],
      }
    )
    expect(afterWhole).toEqual({ kind: "ignore" })
  })

  it("clears the key with a null whole value, keeping newer properties", () => {
    const clocks: RowClocks = { fields: { [p("bio")]: at(2), [p("displayName")]: at(8) } }
    expect(
      mergeSettingProperties({ bio: "x", displayName: "Ada" }, clocks, { value: [null, at(5)] })
    ).toEqual({
      kind: "write",
      value: { displayName: "Ada" },
      clocks: { fields: { value: at(5), [p("displayName")]: at(8) } },
    })
    expect(
      mergeSettingProperties(
        { bio: "x" },
        { fields: { [p("bio")]: at(2) } },
        { value: [null, at(5)] }
      )
    ).toEqual({ kind: "write", value: undefined, clocks: { fields: { value: at(5) } } })
  })

  it("reads a stored whole-value clock as every property's clock", () => {
    // A device that merged the key as a whole before keeps its `value` clock;
    // nothing is migrated.
    const clocks: RowClocks = { fields: { value: at(4) } }
    expect(
      mergeSettingProperties({ bio: "mine" }, clocks, { [p("bio")]: ["older", at(3, B)] })
    ).toEqual({ kind: "ignore" })
    expect(
      mergeSettingProperties({ bio: "mine" }, clocks, { [p("bio")]: ["newer", at(4, B)] })
    ).toMatchObject({ kind: "write", value: { bio: "newer" } })
  })

  it("applies a property this device holds no clock for", () => {
    expect(
      mergeSettingProperties({ bio: "unclocked" }, undefined, { [p("bio")]: ["x", at(1)] })
    ).toMatchObject({ kind: "write", value: { bio: "x" } })
    expect(
      mergeSettingProperties(undefined, undefined, { [p("bio")]: ["x", at(1)] })
    ).toMatchObject({ kind: "write", value: { bio: "x" } })
  })

  it("ignores an op applied a second time, and leaves other fields and the tombstone alone", () => {
    const op = { value: [{ bio: "x" }, at(3)] as ClockedValue, other: [1, at(9)] as ClockedValue }
    const first = mergeSettingProperties(undefined, { fields: {}, tombstone: at(1) }, op)
    expect(first).toEqual({
      kind: "write",
      value: { bio: "x" },
      clocks: { fields: { value: at(3) }, tombstone: at(1) },
    })
    if (first.kind !== "write") return
    expect(mergeSettingProperties(first.value, first.clocks, op)).toEqual({ kind: "ignore" })
  })

  it("keeps a property named __proto__ as a property", () => {
    const result = mergeSettingProperties(undefined, undefined, {
      [p("__proto__")]: [{ polluted: true }, at(1)],
    })
    expect(result.kind).toBe("write")
    if (result.kind !== "write") return
    expect(Object.hasOwn(result.value!, "__proto__")).toBe(true)
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype)
  })

  it("needs a pushed whole write to carry its properties, not null", () => {
    // Device A cleared the key, then received B's whole write W at t5 before
    // pushing; its push carries `value` at W's clock. Device C still has its
    // own name and has not seen W yet.
    const w: ClockedValue = [{ displayName: "Grace" }, at(5, B)]
    const c = { value: { displayName: "Ada" }, clocks: { fields: { [p("displayName")]: at(1) } } }
    const arrive = (pushed: unknown) => {
      let value: unknown = c.value
      let clocks: RowClocks = c.clocks
      for (const op of [{ value: [pushed, w[1]] as ClockedValue }, { value: w }]) {
        const result = mergeSettingProperties(value, clocks, op)
        if (result.kind === "write") ({ value, clocks } = result)
      }
      return value
    }
    // A null at W's clock removes the name, and W itself then ties and is ignored.
    expect(arrive(null)).toBeUndefined()
    // The properties W set, as A holds them, converge with W.
    expect(arrive({ displayName: "Grace" })).toEqual({ displayName: "Grace" })
  })

  it("converges whatever order the ops arrive in", () => {
    // Property writes from two devices on this schema, whole writes from a
    // device on the older one, and a clear.
    const ops: Record<string, ClockedValue>[] = [
      { [p("displayName")]: ["A1", at(2)], [p("bio")]: ["A1 bio", at(2)] },
      { value: [{ displayName: "old", theme: "dark" }, at(3, B)] },
      { [p("bio")]: ["B2 bio", at(4, B)] },
      { value: [null, at(5)] },
      { [p("displayName")]: ["A6", at(6)], [p("theme")]: [null, at(6)] },
      { [p("avatar")]: ["late but old", at(1, B)] },
      { value: [{ avatar: "w7", bio: "w7 bio" }, at(7, B)], [p("displayName")]: ["B8", at(8, B)] },
    ]
    const permutations = <T>(items: T[]): T[][] =>
      items.length <= 1
        ? [items]
        : items.flatMap((item, index) =>
            permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
              item,
              ...rest,
            ])
          )
    const outcomes = new Set<string>()
    for (const order of permutations(ops)) {
      let value: Record<string, unknown> | undefined
      let clocks: RowClocks | undefined
      for (const op of order) {
        const result = mergeSettingProperties(value, clocks, op)
        if (result.kind === "write") ({ value, clocks } = result)
      }
      outcomes.add(JSON.stringify({ value, clocks }))
    }
    expect(outcomes.size).toBe(1)
    expect(JSON.parse([...outcomes][0]!).value).toEqual({
      avatar: "w7",
      bio: "w7 bio",
      displayName: "B8",
    })
  })
})
