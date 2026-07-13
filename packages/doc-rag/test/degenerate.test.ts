import { describe, expect, test } from "bun:test";
import { isDegenerate } from "../src/degenerate";

describe("isDegenerate", () => {
  // Verbatim, from data/eval-cases.json. The model was asked for the continuous
  // drain current of a MOSFET and returned this.
  const SOUP =
    "ulingulingulinguling seeded seeded seeded seeded seeded seeded seeded seeded " +
    "seeded seeded seeded seeded seeded seeded seeded seeded seededuling seededulingulingurum " +
    "seededulinguling seeded seeded seeded se";

  test("catches the decode that fell apart", () => {
    expect(isDegenerate(SOUP)).toBe(true);
  });

  test("leaves a real answer alone, including one that repeats its own units", () => {
    // The obvious false positive: a correct answer about a MOSFET says "A" and
    // "V" and the part number several times over, and a naive repetition test
    // would throw it away. This is the answer the system is supposed to give.
    expect(
      isDegenerate(
        "The continuous drain current (ID) of the BUK9Y12-40E is 52 A at VGS = 5 V; " +
          "Tmb = 25 °C. At VGS = 5 V and ID = 15 A the RDS(on) is 12 mΩ."
      )
    ).toBe(false);
  });

  test("leaves a refusal alone", () => {
    expect(isDegenerate("NOT_IN_CORPUS")).toBe(false);
  });

  test("a short answer is never soup", () => {
    // "-30 V, measured at Tj = 25 °C." repeats nothing, but neither does it have
    // the length to prove it. Short answers are judged on their value, not here.
    expect(isDegenerate("-30 V, measured at Tj = 25 °C.")).toBe(false);
  });
});
