import { describe, expect, test } from "bun:test";
import { buildPrompt, EXCERPT_CHARS, guardRefuses, namedParts, REFUSAL_TOKEN } from "../src/answer";
import { chunk, MAX_CHARS } from "../src/chunk";

/**
 * The prompt had no test at all, which is how it came to show the model half of
 * every chunk it retrieved for weeks. Two constants had to agree — the chunker's
 * ceiling and the prompt's truncation — and nothing checked that they did.
 */

test("the model is shown the whole chunk, not the front of it", () => {
  // A chunk the chunker considers legal, with the answer in its LAST row — where a
  // limiting-values table puts the operating points a question actually distinguishes.
  const padding = "ID   drain current   VGS = 10 V; Tamb = 25 °C; t <= 5 s   -   99   A\n".repeat(20);
  const table = `${padding}ID   drain current   VGS = 10 V; Tamb = 25 °C   -   13   A`;
  expect(table.length).toBeLessThanOrEqual(MAX_CHARS);

  const prompt = buildPrompt("What is the ID of the PMPB14XP?", [{ part: "PMPB14XP", text: table }]);

  // The row the question is about survives the trip into the prompt. It did not:
  // it sat past character 900 and the model answered from the pulse row above it.
  expect(prompt).toContain("-   13   A");
});

test("the excerpt budget is the chunker's ceiling, so no chunk can be cut", () => {
  // The invariant, stated where it can fail loudly. If either constant moves, this
  // is the line that says so — rather than a benchmark quietly losing two points.
  expect(EXCERPT_CHARS).toBeGreaterThanOrEqual(MAX_CHARS);
});

test("every chunk the chunker emits fits in the prompt whole", () => {
  const table = Array.from(
    { length: 200 },
    (_, i) => `ID   drain current   VGS = ${i} V; Tamb = 25 °C   -   ${i}.5   A`
  ).join("\n");

  for (const c of chunk({ id: "PART", title: "PART", text: table })) {
    expect(c.text.length).toBeLessThanOrEqual(EXCERPT_CHARS);
  }
});

test("the refusal contract is a token, not a phrasing", () => {
  const prompt = buildPrompt("What is the ID of the BUK0000?", [{ part: "OTHER", text: "rows" }]);
  expect(prompt).toContain(REFUSAL_TOKEN);
  // The part label is what lets the model see the excerpts are about another part.
  expect(prompt).toContain("[OTHER]");
});

/**
 * The identifier guard.
 *
 * The prompt asks the model to refuse a question about a part it has no excerpt
 * for. On 400 held-out questions the model failed that 17 times, and the way it
 * failed is the point: `PSMN1R0-30YLD` is a 30 V part and its NAME says so, so the
 * model read the naming convention and answered "30 V" about a datasheet it had
 * never seen. It was right. A right answer with no document behind it is the worst
 * output this system has, because nothing distinguishes it from a grounded one.
 */
describe("the identifier guard", () => {
  const ask = (part: string) => `What is the drain-source voltage rating (VDS) of the ${part}?`;

  test("refuses when no retrieved chunk comes from the part named", () => {
    expect(guardRefuses(ask("PSMN1R0-30YLD"), ["PSMN1R0-30YLC", "PSMN1R5-30YL"])).toBe(true);
  });

  test("does NOT refuse when the named part was retrieved", () => {
    // The expensive direction to get wrong: this guard eating a real answer.
    expect(guardRefuses(ask("PSMN1R0-30YLD"), ["PSMN1R0-30YLC", "PSMN1R0-30YLD"])).toBe(false);
  });

  test("a part number is not its lookalike neighbour", () => {
    // One character apart, a different component, and the whole holdout trap.
    expect(guardRefuses(ask("BUK9M43-100E"), ["BUK9M34-100E"])).toBe(true);
  });

  test("stands aside when the question names no part", () => {
    // Nothing to check: the model decides, as it did before the guard existed.
    expect(guardRefuses("What does RDS(on) mean?", ["PSMN1R0-30YLD"])).toBe(false);
  });

  test("it reads the part out of a question full of numbers and symbols", () => {
    const q = "What drain current (ID) is the PMPB14XP rated for at VGS = -4.5 V; Tamb = 25 °C?";
    expect(namedParts(q)).toEqual(["PMPB14XP"]);
  });
});
