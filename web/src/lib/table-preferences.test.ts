import { describe, expect, it } from "vitest";
import { csvText } from "./table-preferences";
describe("CSV export", () => {
  it("escapes quotes and line breaks and neutralizes spreadsheet formulas", () => {
    expect(csvText([["a,b", 'say "hello"', "line\nbreak"], ["=cmd()", "  +123", "@SUM(A1)"]])).toBe('"a,b","say ""hello""","line\nbreak"\r\n"\'=cmd()","\'  +123","\'@SUM(A1)"');
  });
});
