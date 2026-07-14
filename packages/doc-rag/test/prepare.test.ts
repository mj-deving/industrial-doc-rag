import { describe, expect, test } from "bun:test";
import { bind, prepare, strip } from "../src/prepare";

describe("strip", () => {
  test("drops the disclaimer stamped into every page footer", () => {
    const text = [
      " ID    drain current    VGS = 10 V    -   13   A",
      "PMPB11EN       All information provided in this document is subject to legal disclaimers.",
      "Product data sheet                     16 April 2018                          4 / 15",
      "Nexperia",
      " RDSon  on-state resistance  VGS = 10 V   -   12   mΩ"
    ].join("\n");

    const kept = strip(text);
    expect(kept).toContain("13   A");
    expect(kept).toContain("12   mΩ");
    expect(kept).not.toContain("legal disclaimers");
    expect(kept).not.toContain("Product data sheet");
  });

  test("cuts everything from the legal-information section to the end", () => {
    const text = [
      "14. Revision history",
      "  v.2  20190301  first release",
      "15. Legal information            Right to make changes",
      "Nexperia reserves the right to make changes without notice.",
      "16. Contact information"
    ].join("\n");

    const kept = strip(text);
    expect(kept).toContain("Revision history");
    expect(kept).not.toContain("Right to make changes");
    expect(kept).not.toContain("Contact information");
  });

  test("a document with no legal section survives whole", () => {
    const text = " ID   drain current   VGS = 10 V   -   13   A";
    expect(strip(text)).toBe(text);
  });
});

describe("bind", () => {
  // The datasheet names ID once and lists two more rows under it with the symbol
  // column blank. Severed from the first row by a chunk boundary, the second row
  // is a number belonging to nothing.
  test("binds the symbol onto the rows that inherit it", () => {
    const table = [
      " ID     drain current      VGS = 10 V; Tamb = 25 °C; t ≤ 5 s    [1]   -   13    A",
      "                           VGS = 10 V; Tamb = 25 °C             [1]   -   9     A",
      "                           VGS = 10 V; Tamb = 100 °C            [1]   -   5.7   A"
    ].join("\n");

    const rows = bind(table).split("\n");
    expect(rows[1]).toContain("ID");
    expect(rows[1]).toContain("drain current");
    expect(rows[1]).toContain("9");
    expect(rows[2]).toContain("ID");
    expect(rows[2]).toContain("5.7");
  });

  // A long parameter name wraps onto its own line, and the row underneath that
  // wrap is still the same parameter. Losing the symbol there orphans the second
  // gate-drive row — which is the row the question asks about on every part with a
  // two-gate-drive RDS(on) table.
  test("the symbol survives a wrapped parameter name", () => {
    const table = [
      " RDSon   drain-source on-state   VGS = 4.5 V; ID = 25 A; Tj = 25 °C   -   1.1    1.4    mΩ",
      "         resistance Fig. 12",
      "                                 VGS = 10 V; ID = 25 A; Tj = 25 °C    -   0.85   1.15   mΩ"
    ].join("\n");

    const rows = bind(table).split("\n");
    expect(rows[2]).toContain("RDSon");
    expect(rows[2]).toContain("1.15");
  });

  test("a symbol does not reach across a blank line into the next block", () => {
    const text = [
      " ID    drain current   VGS = 10 V   -   13   A",
      "",
      "                       VGS = 10 V   -   9    A"
    ].join("\n");

    const rows = bind(text).split("\n");
    expect(rows[2]).not.toContain("drain current");
  });

  test("leaves prose alone", () => {
    const prose = "The device is a Trench MOSFET intended for DC-to-DC converters.";
    expect(bind(prose)).toBe(prose);
  });
});

describe("prepare", () => {
  // The invariant chunk.ts is built on: a fact the label knows is a fact a chunk
  // contains. Boilerplate removal is only safe while this holds.
  test("keeps every value while removing the furniture around it", () => {
    const text = [
      " ID     drain current   VGS = 10 V; Tamb = 25 °C; t ≤ 5 s   -   13   A",
      "                        VGS = 10 V; Tamb = 25 °C            -   9    A",
      "PMPB11EN      All information provided in this document is subject to legal disclaimers.",
      "15. Legal information",
      "Nexperia reserves the right to make changes."
    ].join("\n");

    const ready = prepare(text);
    expect(ready).toContain("13");
    expect(ready).toContain("9");
    expect(ready.split("\n")[1]).toContain("ID");
    expect(ready).not.toContain("legal disclaimers");
    expect(ready).not.toContain("right to make changes");
  });
});
