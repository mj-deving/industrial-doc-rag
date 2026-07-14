/**
 * Extract candidate part numbers from the Nexperia Selection Guide text dump.
 *
 * Input:  a `pdftotext -layout` render of the selection guide.
 * Output: newline-separated candidate part numbers on stdout.
 *
 * These are CANDIDATES, not verified parts. The guide's column tables survive
 * pdftotext badly, so the token stream carries glued-together artefacts
 * (PSMNR..., PHDMI...). We do not try to perfect the regex here: fetch.ts is
 * the real filter, because a part that has no datasheet URL returns 404 and
 * drops out on its own. A deterministic 404 beats a clever regex.
 */

const PREFIXES = ["PSMN", "BUK", "PMPB", "PMV", "PXN", "PMN", "PHP", "PHD", "PHT", "BSC"];
const PART = new RegExp(`\\b(?:${PREFIXES.join("|")})[A-Z0-9]+(?:-[A-Z0-9]+)*\\b`, "g");

const path = process.argv[2];
if (!path) {
  console.error("usage: bun tools/parts.ts <selection-guide.txt>");
  process.exit(1);
}

const text = await Bun.file(path).text();
const parts = new Set<string>();

for (const match of text.matchAll(PART)) {
  const part = match[0];
  // A real Nexperia part number always carries at least one digit and is not a
  // bare prefix. Both filters are cheap and remove obvious table noise.
  if (part.length < 6 || !/\d/.test(part)) continue;
  parts.add(part);
}

for (const part of [...parts].sort()) console.log(part);
console.error(`${parts.size} candidate part numbers`);

export {};
