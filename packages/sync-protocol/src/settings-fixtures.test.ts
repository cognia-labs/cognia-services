/**
 * Frozen settings vectors (fixtures/v1-settings.json). A failure means the
 * settings encoding or its merge changed: settings already in a space would
 * stop merging the same way. Fix the code; never regenerate the file.
 */
import { readFileSync } from "node:fs"
import path from "node:path"

import { mergeSettingProperties, settingsPropertyField, settingsPropertyOf } from "./settings"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SETTINGS: any = JSON.parse(
  readFileSync(path.join(__dirname, "..", "fixtures", "v1-settings.json"), "utf8")
)

describe("protocol v1 settings fixtures", () => {
  it("names and reads property fields", () => {
    for (const { property, field } of SETTINGS.fields.named)
      expect(settingsPropertyField(property)).toBe(field)
    for (const { field, property } of SETTINGS.fields.read)
      expect(settingsPropertyOf(field)).toBe(property)
  })

  it("merges to the frozen outcomes", () => {
    for (const { current, clocks, incoming, expected } of SETTINGS.merge)
      expect(mergeSettingProperties(current, clocks, incoming)).toEqual(expected)
  })
})
