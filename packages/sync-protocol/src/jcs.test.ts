import vectorFile from "../fixtures/jcs-vectors.json"
import { canonicalizeJson, CanonicalJsonError } from "./jcs"

interface JcsVector {
  name: string
  input: unknown
  expected: string
}

describe("JCS copy", () => {
  it.each(vectorFile.vectors as JcsVector[])(
    "matches the shared golden vector: $name",
    ({ input, expected }) => {
      expect(canonicalizeJson(input)).toBe(expected)
    }
  )

  it("refuses values that are not JSON", () => {
    expect(() => canonicalizeJson({ a: undefined, b: Number.NaN })).toThrow(CanonicalJsonError)
    expect(() => canonicalizeJson(new Date(0))).toThrow(CanonicalJsonError)
    expect(() => canonicalizeJson("\ud800")).toThrow(CanonicalJsonError)
  })
})
