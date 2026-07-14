import { expect, test } from "bun:test";
import { buildPrompt, EXCERPT_CHARS, REFUSAL_TOKEN } from "../src/answer";
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
