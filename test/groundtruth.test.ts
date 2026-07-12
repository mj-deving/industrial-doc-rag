import { describe, expect, test } from "bun:test";
import { decodeName, parseDatasheet } from "../tools/groundtruth";

// Verbatim `pdftotext -layout` output. The whitespace IS the format: the parser
// anchors on the last four fields of a row, so a fixture that tidies the columns
// would test something the real corpus never produces.
const PMV45EN = `                                PMV45EN
                                N-channel TrenchMOS logic level FET

1.4 Quick reference data
Table 1.    Quick reference data
Symbol             Parameter                Conditions                       Min       Typ       Max   Unit
VDS                drain-source voltage     Tj >= 25 °C; Tj <= 150 °C        -         -         30    V
ID                 drain current            Tsp = 25 °C; VGS = 10 V;         -         -         5.4   A
                                            see Figure 3
VGS                gate-source voltage                                       -20       -         20    V
Static characteristics
RDSon              drain-source on-state    VGS = 10 V; ID = 2 A; Tj = 25 °C -         35        42    mΩ
                   resistance               Figure 9; see Figure 10

2. Pinning information
`;

// The row order here is the whole reason condition-based selection exists: the
// 100 °C row is printed FIRST, so "take the first RDSon row" reports 25 mΩ for a
// part whose 25 °C figure is 13.9 mΩ.
const PSMN013 = `                           PSMN013-100BS
                           N-channel MOSFET in D2PAK

5. Quick reference data
Symbol          Parameter                  Conditions                            Min   Typ    Max    Unit
VDS            drain-source voltage        25 °C <= Tj <= 175 °C                  -     -      100    V
ID             drain current               VGS = 10 V; Tmb = 25 °C          [1]   -     -      68     A
Static characteristics
RDSon           drain-source on-state      VGS = 10 V; ID = 15 A; Tj = 100 °C     -     19.4   25     mΩ
                resistance                 Fig. 12; Fig. 13
                                           VGS = 10 V; ID = 15 A; Tj = 25 °C      -     10.8   13.9   mΩ
                                           Fig. 13
Dynamic characteristics
QGD             gate-drain charge          VGS = 10 V; ID = 25 A                  -     17     23.8   nC
`;

// A logic-level part publishing two gate drives at 25 °C. Reading the 4.5 V row
// when a 10 V row exists inflates RDSon by ~1.6x — a silent 60% grading error.
const DUAL_VGS = `                           PSMN5R3-25MLD
                           N-channel 25 V logic level MOSFET in LFPAK33

5. Quick reference data
Symbol          Parameter                  Conditions                            Min   Typ    Max    Unit
VDS            drain-source voltage        25 °C <= Tj <= 175 °C                  -     -      25     V
ID             drain current               VGS = 10 V; Tmb = 25 °C                -     -      100    A
Static characteristics
RDSon           drain-source on-state      VGS = 4.5 V; ID = 15 A; Tj = 25 °C     -     7.07   8.49   mΩ
                resistance                 Fig. 10
                                           VGS = 10 V; ID = 15 A; Tj = 25 °C      -     4.9    5.9    mΩ
`;

describe("parseDatasheet", () => {
  test("reads the quick-reference table of a 2011 datasheet", () => {
    const gt = parseDatasheet("PMV45EN", PMV45EN)!;
    expect(gt.channel).toBe("N");
    expect(gt.vds_v).toBe(30);
    expect(gt.id_a?.value).toBe(5.4);
    expect(gt.rdson_mohm?.value).toBe(42);
  });

  test("selects RDSon by condition, not by row order", () => {
    const gt = parseDatasheet("PSMN013-100BS", PSMN013)!;
    // 25 mΩ is the first row and the wrong answer; 13.9 mΩ is the 25 °C figure.
    expect(gt.rdson_mohm?.value).toBe(13.9);
    expect(gt.rdson_mohm?.conditions).toContain("Tj = 25");
  });

  test("prefers the 10 V gate drive when a part publishes several", () => {
    const gt = parseDatasheet("PSMN5R3-25MLD", DUAL_VGS)!;
    expect(gt.rdson_mohm?.value).toBe(5.9);
    expect(gt.rdson_mohm?.conditions).toContain("VGS = 10 V");
  });

  test("every label carries the conditions it was measured at", () => {
    for (const [part, text] of [
      ["PMV45EN", PMV45EN],
      ["PSMN013-100BS", PSMN013],
      ["PSMN5R3-25MLD", DUAL_VGS]
    ] as const) {
      const gt = parseDatasheet(part, text)!;
      // An unconditioned RDSon figure is not a well-posed answer: the same part
      // reads 13.9 or 25 mΩ depending on junction temperature alone.
      expect(gt.rdson_mohm?.conditions).toMatch(/VGS = .+; ID = .+; Tj = /);
    }
  });

  test("returns null when the document has no quick-reference table", () => {
    expect(parseDatasheet("X", "N-channel something\nNo table here.")).toBeNull();
  });

  test("normalises P-channel figures to their magnitude", () => {
    const p = PMV45EN.replace("N-channel", "P-channel").replace("30    V", "-30   V");
    expect(parseDatasheet("PMV48XP", p)!.vds_v).toBe(30);
  });
});

describe("decodeName", () => {
  test("reads the R as a decimal point with exactly one digit in front", () => {
    // A greedy \d+R\d+ reads this as 764 mΩ: a 190x error that looks like a
    // parser bug and is not one.
    expect(decodeName("BUK764R0-40E")).toEqual({ rdson_mohm: 4.0, vds_v: 40 });
    expect(decodeName("PSMN1R0-30YLD")).toEqual({ rdson_mohm: 1.0, vds_v: 30 });
    expect(decodeName("BUK7K5R1-30E")).toEqual({ rdson_mohm: 5.1, vds_v: 30 });
  });

  test("reads the integer milliohm form", () => {
    expect(decodeName("PSMN013-100BS")).toEqual({ rdson_mohm: 13, vds_v: 100 });
  });

  test("declines part numbers that do not carry the convention", () => {
    expect(decodeName("PMV45EN")).toBeNull();
  });
});
