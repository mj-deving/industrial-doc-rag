/**
 * The catalogue answers with an exact number, so every way it can be exactly wrong
 * is pinned here. The fixtures are not invented: each one is a shape the 70B model
 * actually produced during the first extraction over the real corpus, copied out of
 * `data/attributes-quality.json`. A hand-written fixture tests the code against my
 * memory of the model, and my memory of the model is the thing under test.
 */

import { describe, expect, test } from "bun:test";
import { classOf, cleanConditions, cleanPackages, type Attributes } from "../src/api/contracts";
import { runQuery, vocabulary, type QuerySpec } from "../src/api/catalog";

const row = (part: string, over: Partial<Attributes> = {}): Attributes => ({
  part,
  vds: 40,
  rdson: [{ value: 10, unit: "mΩ", conditions: "VGS = 10 V; ID = 25 A; Tj = 25 °C" }],
  id: [{ value: 50, unit: "A", conditions: "VGS = 10 V; Tmb = 25 °C" }],
  package: ["LFPAK56"],
  ...over
});

describe("what the model wrote, and what a table needs", () => {
  test("a figure reference rode along with the conditions and must not become a class", () => {
    // Verbatim from the run: the catalogue said this, the label said the same
    // without the figure, and 209 parts were counted as disagreeing.
    expect(cleanConditions("VGS = 10 V; ID = 20 A; Tj = 25 °C; Fig. 12")).toBe(
      "VGS = 10 V; ID = 20 A; Tj = 25 °C"
    );
    expect(cleanConditions("VGS = 10 V; ID = 15 A; Tj = 25 °C;")).toBe("VGS = 10 V; ID = 15 A; Tj = 25 °C");
  });

  test("the class drops the drain current and keeps the gate voltage", () => {
    expect(classOf("VGS = 10 V; ID = 20 A; Tj = 25 °C; Fig. 12")).toBe("Tj = 25 °C; VGS = 10 V");
  });

  test("the ORDER the conditions are printed in is not a condition", () => {
    // Measured on the real extraction: the model wrote `VGS = 10 V; Tmb = 25 °C` for
    // 43 parts and `Tmb = 25 °C; VGS = 10 V` for 25 more, and they are the same test
    // bench. Keeping the printed order made them two classes, so a superlative over
    // that class silently competed 43 parts instead of 68 and named the best of a
    // subset. The number would be exact, the winner wrong, and nothing would look
    // broken. The label file splits the same way (276 / 100), which is why the truth
    // generator already sorts and this one has to as well.
    expect(classOf("VGS = 10 V; Tmb = 25 °C")).toBe(classOf("Tmb = 25 °C; VGS = 10 V"));
  });

  test("sorting reorders terms, it never merges different ones", () => {
    expect(classOf("Tmb = 25 °C; VGS = 10 V")).not.toBe(classOf("Tamb = 25 °C; VGS = 10 V"));
    expect(classOf("Tj = 25 °C; VGS = 5 V")).not.toBe(classOf("VGS = 10 V; Tj = 25 °C"));
  });

  test("a part written both ways is ONE competitor in its class, not two", () => {
    // The end-to-end consequence, at the query rather than the string.
    const rows: Attributes[] = [
      row("A", { id: [{ value: 50, unit: "A", conditions: "VGS = 10 V; Tmb = 25 °C" }] }),
      row("B", { id: [{ value: 90, unit: "A", conditions: "Tmb = 25 °C; VGS = 10 V" }] })
    ];
    const spec: QuerySpec = { op: "max", field: "id", filters: {} };
    const found = runQuery(spec, rows);
    // Unsorted, these are two classes and the answer hedges across both. B has to win
    // outright, against A, in the one class they actually share.
    expect(found.kind).toBe("extremum");
    expect(found.kind === "extremum" && found.parts).toEqual(["B"]);
    expect(found.kind === "extremum" && found.candidates).toBe(2);
  });

  test("a mounting-base rating is never in the same class as an ambient one", () => {
    // Tmb holds the mounting base at 25 C, which assumes a heatsink. Tamb is free
    // air. The same die quotes a much larger current under the first.
    expect(classOf("VGS = 10 V; Tmb = 25 °C")).not.toBe(classOf("VGS = 10 V; Tamb = 25 °C"));
  });

  test("three names in one string are three names", () => {
    // Verbatim: the model returned this, the label had the three separately, and 194
    // parts were counted as disagreeing.
    expect(cleanPackages(["LFPAK56; Power-SO8 (SOT669)"]).sort()).toEqual(
      ["LFPAK56", "Power-SO8", "SOT669"].sort()
    );
    expect(cleanPackages(["TO-236AB (SOT23)"]).sort()).toEqual(["SOT23", "TO-236AB"].sort());
  });

  test("a sentence describing the package is not a name for it", () => {
    expect(cleanPackages(["plastic, surface-mounted package"])).not.toContain("plastic");
  });
});

describe("a comparison across conditions is not a comparison", () => {
  const rows = [
    // The cheap part, but only at a gate drive the question did not ask for.
    row("LOW-AT-4V5", {
      rdson: [{ value: 1, unit: "mΩ", conditions: "VGS = 4.5 V; ID = 25 A; Tj = 25 °C" }]
    }),
    row("WINNER", { rdson: [{ value: 5, unit: "mΩ", conditions: "VGS = 10 V; ID = 25 A; Tj = 25 °C" }] }),
    row("LOSER", { rdson: [{ value: 9, unit: "mΩ", conditions: "VGS = 10 V; ID = 25 A; Tj = 25 °C" }] })
  ];

  test("a part measured at another gate drive does not win the comparison", () => {
    const spec: QuerySpec = {
      op: "min",
      field: "rdson",
      filters: { vds: 40, conditions: "VGS = 10 V; Tj = 25 °C" }
    };
    const result = runQuery(spec, rows);
    expect(result.kind).toBe("extremum");
    if (result.kind !== "extremum") return;
    expect(result.parts).toEqual(["WINNER"]);
    expect(result.value).toBe(5);
    expect(result.candidates).toBe(2);
  });

  test("with no conditions named, every class is answered rather than one guessed", () => {
    const result = runQuery({ op: "min", field: "rdson", filters: { vds: 40 } }, rows);
    expect(result.kind).toBe("ambiguous-conditions");
    if (result.kind !== "ambiguous-conditions") return;
    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((g) => g.parts).flat().sort()).toEqual(["LOW-AT-4V5", "WINNER"]);
  });
});

describe("a part competes in every class its datasheet quotes", () => {
  // This is what the single-measurement schema got wrong, and it got it wrong in the
  // dangerous direction: the part vanished from a comparison it belongs in, and the
  // superlative returned the best of what was left, exactly and confidently.
  const both = row("BOTH", {
    rdson: [
      { value: 2.4, unit: "mΩ", conditions: "VGS = 10 V; ID = 25 A; Tj = 25 °C" },
      { value: 3.6, unit: "mΩ", conditions: "VGS = 4.5 V; ID = 25 A; Tj = 25 °C" }
    ]
  });
  const rows = [both, row("TEN-ONLY", { rdson: [{ value: 3, unit: "mΩ", conditions: "VGS = 10 V; Tj = 25 °C" }] })];

  test("it wins the 10 V comparison", () => {
    const result = runQuery(
      { op: "min", field: "rdson", filters: { conditions: "VGS = 10 V; Tj = 25 °C" } },
      rows
    );
    expect(result.kind).toBe("extremum");
    if (result.kind !== "extremum") return;
    expect(result.parts).toEqual(["BOTH"]);
    expect(result.value).toBe(2.4);
  });

  test("and it is still the only entrant at 4.5 V", () => {
    const result = runQuery(
      { op: "min", field: "rdson", filters: { conditions: "VGS = 4.5 V; Tj = 25 °C" } },
      rows
    );
    expect(result.kind).toBe("extremum");
    if (result.kind !== "extremum") return;
    expect(result.parts).toEqual(["BOTH"]);
    expect(result.value).toBe(3.6);
  });
});

describe("counts and ties", () => {
  const rows = [
    row("A", { package: ["LFPAK56", "Power-SO8", "SOT669"] }),
    row("B", { package: ["LFPAK56"] }),
    row("C", { package: ["SOT23"] })
  ];

  test("a count is over the whole table, not over what retrieval returned", () => {
    const result = runQuery({ op: "count", filters: { package: "LFPAK56" } }, rows);
    expect(result.kind).toBe("count");
    if (result.kind !== "count") return;
    expect(result.count).toBe(2);
  });

  test("any true name of a package finds the part", () => {
    const byAlias = runQuery({ op: "count", filters: { package: "SOT669" } }, rows);
    expect(byAlias.kind === "count" && byAlias.count).toBe(1);
  });

  test("every part tied at the extremum is returned, not the first one found", () => {
    const tied = [
      row("T1", { rdson: [{ value: 4, unit: "mΩ", conditions: "VGS = 10 V; Tj = 25 °C" }] }),
      row("T2", { rdson: [{ value: 4, unit: "mΩ", conditions: "VGS = 10 V; Tj = 25 °C" }] })
    ];
    const result = runQuery(
      { op: "min", field: "rdson", filters: { conditions: "VGS = 10 V; Tj = 25 °C" } },
      tied
    );
    expect(result.kind === "extremum" && result.parts.sort()).toEqual(["T1", "T2"]);
  });

  test("a P-channel part is ranked on magnitude, not on the sign it prints", () => {
    const p = [
      row("P-BIG", { vds: -30, id: [{ value: -8.8, unit: "A", conditions: "VGS = -10 V; Tamb = 25 °C" }] }),
      row("P-SMALL", { vds: -30, id: [{ value: -2.4, unit: "A", conditions: "VGS = -10 V; Tamb = 25 °C" }] })
    ];
    const result = runQuery(
      { op: "max", field: "id", filters: { channel: "P", conditions: "VGS = -10 V; Tamb = 25 °C" } },
      p
    );
    expect(result.kind === "extremum" && result.parts).toEqual(["P-BIG"]);
  });
});

describe("the vocabulary comes from the table, never from a hand-written list", () => {
  test("it reports what the corpus actually contains", () => {
    const vocab = vocabulary([row("A", { package: ["LFPAK33"] }), row("B", { vds: -30 })]);
    expect(vocab.packages).toContain("LFPAK33");
    expect(vocab.ratings.sort()).toEqual([30, 40]);
    // Canonical, not as printed: the vocabulary is what the planner is allowed to
    // name, so it must hold one string per class. Listing both orderings of the same
    // test bench would tell the planner the corpus has two.
    expect(vocab.rdsonConditions).toEqual(["Tj = 25 °C; VGS = 10 V"]);
  });
});

/**
 * Three ways a package name can be spelled apart from itself, and each one cost a
 * question in the run of 2026-07-14. They are the same bug wearing three coats: the
 * name a buyer types, the name the datasheet prints, and the name the model writes
 * are compared as exact strings, so any disagreement about where the name ENDS
 * silently removes parts from a count or removes a count from the system entirely.
 */
describe("a package name is not an exact string", () => {
  test("a typographic hyphen is typography, not a different package", () => {
    // The label carries the datasheet's non-breaking hyphen (U+2011) on 16 parts and
    // an ASCII hyphen on 32. One package, two counts, and neither is 48.
    expect(cleanPackages(["DFN2020MD‑6"])).toEqual(["DFN2020MD-6"]);
    expect(cleanPackages(["TO–236AB"])).toEqual(["TO-236AB"]);
  });

  test("a SOT version suffix is a variant of the SOT package, and counts as one", () => {
    // Confirmed against the label, not asserted: all 18 parts the model filed under
    // SOT1220-2, and all 7 under SOT8002-1, are labelled SOT1220 and SOT8002 by a
    // parser that read the ordering table. The version is a column, not a package.
    expect(cleanPackages(["SOT1220-2"]).sort()).toEqual(["SOT1220", "SOT1220-2"]);
    expect(cleanPackages(["SOT8002-1"]).sort()).toEqual(["SOT8002", "SOT8002-1"]);
  });

  test("a lead count is part of the name and keeps its own identity", () => {
    // The narrow rule earns its narrowness: DFN2020MD-6 is a six-lead DFN2020MD and
    // the label never writes DFN2020MD alone. Only a SOT code takes a version suffix.
    expect(cleanPackages(["DFN2020MD-6"])).toEqual(["DFN2020MD-6"]);
    expect(cleanPackages(["TO-236AB"])).toEqual(["TO-236AB"]);
  });
});
