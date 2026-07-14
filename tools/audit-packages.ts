/**
 * A third mechanism, to settle a disagreement between the first two.
 *
 * The catalogue (a 70B model reading retrieved chunks) and the label (a parser reading
 * the PDF's tables) disagree about package names on 14 parts, and the count questions
 * they feed are wrong in both directions at once. Grading one against the other cannot
 * say which is wrong, because that is the only thing the two of them cannot tell you.
 *
 * So: ask the document. `pdftotext` over the raw PDF is neither of the two mechanisms —
 * no table parser, no model, no retrieval. If a name is printed anywhere in the
 * datasheet, the text contains it; if it is not printed, nothing put it there. For a
 * question about what a part's package is CALLED, that is as close to the fact as this
 * corpus gets.
 *
 * Two error rates come out of it, and they are opposite failures that were cancelling:
 *
 *   FABRICATED   the catalogue names a package the datasheet never prints
 *   MISSED       the datasheet prints a package name the label does not carry
 *
 * Usage: bun tools/audit-packages.ts
 */

import { cleanPackages } from "../src/api/contracts";
import { isHoldout } from "./split";
import type { GroundTruth } from "./groundtruth";
import type { Attributes } from "../src/api/contracts";

const catalogue: Attributes[] = await Bun.file("data/attributes.json").json();
const labels: GroundTruth[] = await Bun.file("data/groundtruth.json").json();
const indexed = labels.filter((l) => !isHoldout(l.part));
const byPart = new Map(indexed.map((l) => [l.part, cleanPackages(l.package ?? [])]));

/** Every package name either mechanism believes in. The audit asks the document about
 *  each one, so the vocabulary has to be the union — a name only the model wrote is
 *  exactly the kind this is here to catch. */
const vocabulary = [
  ...new Set([...catalogue.flatMap((r) => r.package), ...indexed.flatMap((l) => cleanPackages(l.package ?? []))])
].sort((a, b) => b.length - a.length);

/** Printed, not merely contained. `SOT669` appears inside `SOT669X` and that is a
 *  different designator, so the name has to stand alone in the text. */
const printed = (text: string, name: string) =>
  new RegExp(`(^|[^A-Za-z0-9-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9-])`).test(text);

type Row = { part: string; fabricated: string[]; missedByLabel: string[]; missedByCatalogue: string[] };

const rows: Row[] = [];
let read = 0;

for (const row of catalogue) {
  const file = Bun.file(`corpus/${row.part}.pdf`);
  if (!(await file.exists())) continue;

  const text = await new Response(
    Bun.spawn(["pdftotext", `corpus/${row.part}.pdf`, "-"], { stdout: "pipe" }).stdout
  ).text();
  read++;

  // The document's names go through the catalogue's own normaliser before the compare.
  // Without it the audit reports its own normalisation as a fabrication: PMPB06R2EN's
  // datasheet prints only `SOT1220-2`, the label's parser files it as `SOT1220`, and
  // `cleanPackages` derives the same base name — so a raw compare called 20 correctly
  // normalised rows invented. An instrument that compares a normalised value against a
  // raw one measures the normaliser, which is the fifth time that has happened here.
  const inDocument = new Set(cleanPackages(vocabulary.filter((name) => printed(text, name))));
  const inCatalogue = new Set(row.package);
  const inLabel = new Set(byPart.get(row.part) ?? []);

  rows.push({
    part: row.part,
    fabricated: [...inCatalogue].filter((name) => !inDocument.has(name)),
    missedByLabel: [...inDocument].filter((name) => !inLabel.has(name)),
    missedByCatalogue: [...inDocument].filter((name) => !inCatalogue.has(name))
  });

  if (read % 100 === 0) console.error(`  ${read}/${catalogue.length}`);
}

const count = (pick: (r: Row) => string[]) => rows.filter((r) => pick(r).length > 0).length;
const names = (pick: (r: Row) => string[]) => {
  const tally = new Map<string, number>();
  for (const row of rows) for (const name of pick(row)) tally.set(name, (tally.get(name) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1]);
};

const summary = {
  generatedAt: new Date().toISOString(),
  partsAudited: read,
  /** The catalogue names a package the datasheet does not print. This is the model
   *  writing rather than reading, and it is the failure that a grade against the label
   *  cannot see, because the label misses names too. */
  catalogueFabricated: { parts: count((r) => r.fabricated), names: names((r) => r.fabricated) },
  /** The datasheet prints a name the label does not carry. The label is a parser and it
   *  reads the ordering table; a name printed in another column is a name it never sees. */
  labelMissed: { parts: count((r) => r.missedByLabel), names: names((r) => r.missedByLabel) },
  catalogueMissed: { parts: count((r) => r.missedByCatalogue), names: names((r) => r.missedByCatalogue) }
};

await Bun.write("data/packages-audit.json", JSON.stringify({ ...summary, rows }, null, 2));

console.error(`\nparts audited against the PDF itself   ${summary.partsAudited}\n`);
console.error(`catalogue names a package the PDF never prints   ${summary.catalogueFabricated.parts} parts`);
for (const [name, n] of summary.catalogueFabricated.names.slice(0, 8)) console.error(`    ${name.padEnd(14)} ${n}`);
console.error(`\nPDF prints a name the LABEL does not carry       ${summary.labelMissed.parts} parts`);
for (const [name, n] of summary.labelMissed.names.slice(0, 8)) console.error(`    ${name.padEnd(14)} ${n}`);
console.error(`\nPDF prints a name the CATALOGUE does not carry   ${summary.catalogueMissed.parts} parts`);
for (const [name, n] of summary.catalogueMissed.names.slice(0, 8)) console.error(`    ${name.padEnd(14)} ${n}`);
console.error(`\nwrote data/packages-audit.json`);
