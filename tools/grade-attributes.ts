/**
 * What the reading was worth: the catalogue graded against a label it never saw.
 *
 * Two mechanisms, one corpus:
 *
 *   the LABEL       a deterministic parser reading the PDF's tables (tools/groundtruth.ts)
 *   the CATALOGUE   a 70B model reading the chunks the retriever returns (api/extract.ts)
 *
 * Grading one against the other means something precisely because neither can see the
 * other. Where they disagree, one of them is wrong, and the disagreement is written
 * out with BOTH values so a human can say which. Three times in this project it was
 * the label.
 *
 * ── Why this is its own file ─────────────────────────────────────────────────
 *
 * It used to be the second half of `extract-attributes.ts`, which meant a re-grade
 * cost 497 model calls and twenty minutes. So when the grader itself was wrong — and
 * it was, twice — the cheap move was to believe the number rather than re-run it. The
 * first extraction reported 0.51 agreement on conditions and it was the compare that
 * was broken, not the model. The second reported 0.75 on ID because the grader had
 * loaded a stale copy of `classOf` that treated `VGS = 10 V; Tmb = 25 °C` and
 * `Tmb = 25 °C; VGS = 10 V` as different test benches.
 *
 * An expensive artifact and the analysis of it are separate programs. The extraction
 * writes the table; this grades whatever table is on disk, for free, as often as the
 * grader changes.
 *
 * Usage: bun tools/grade-attributes.ts
 */

import { classOf, type Attributes, type Measured } from "../src/api/contracts";
import type { GroundTruth, Measurement } from "./groundtruth";

const TOLERANCE = 0.01;

export type Disagreement = { part: string; field: string; catalogue: string; label: string };

export type Quality = {
  parts: number;
  /** Agreement with a label the extractor cannot see. NOT "accuracy": where the two
   *  disagree, the label is not automatically right. */
  agreementWithLabel: {
    vds: number;
    rdson: number;
    id: number;
    package: number;
    rdsonConditions: number;
    idConditions: number;
  };
  disagreements: Disagreement[];
};

const close = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * TOLERANCE;

/**
 * The catalogue holds EVERY row a datasheet quotes; the label holds one. So the
 * question is not "do the two single values match" but "does the catalogue carry a
 * row in the label's condition class, with the label's value".
 *
 * That is the property the queries actually depend on. A part missing from the
 * VGS = 10 V class does not produce a wrong value: it vanishes from that comparison,
 * and the superlative returns the best of what is left. The winner is then wrong, the
 * number exact, and nothing looks broken.
 */
const carries = (rows: Measured[], want: Measurement) =>
  rows.some(
    (m) => classOf(m.conditions) === classOf(want.conditions) && close(Math.abs(m.value), Math.abs(want.value))
  );

/** Reported separately from the value, because the two fail differently. A wrong value
 *  is wrong. A MISSING condition class is the silent one. */
const inClass = (rows: Measured[], want: Measurement) =>
  rows.some((m) => classOf(m.conditions) === classOf(want.conditions));

export function grade(catalogue: Attributes[], labels: GroundTruth[]): Quality {
  const byPart = new Map(labels.map((l) => [l.part, l]));
  const disagreements: Disagreement[] = [];

  const fields = ["vds", "rdson", "id", "package", "rdsonConditions", "idConditions"] as const;
  const agree = Object.fromEntries(fields.map((f) => [f, 0])) as Record<(typeof fields)[number], number>;
  const present = Object.fromEntries(fields.map((f) => [f, 0])) as Record<(typeof fields)[number], number>;

  for (const got of catalogue) {
    const label = byPart.get(got.part);
    if (!label) continue;

    // LAZY, and that is not a style choice. The first version passed `ok` as a value,
    // so `close(got.rdson.value, label.rdson!.value)` was evaluated at the call site,
    // before the `hasLabel` guard inside the function could run, and it threw on the
    // first part with no on-resistance in its label — after 497 model calls. A guard
    // inside a function does not protect the arguments handed to it, and the `!` I
    // wrote to quiet the compiler was exactly the assertion that was false.
    const check = (
      field: (typeof fields)[number],
      hasLabel: boolean,
      ok: () => boolean,
      catalogueSaid: () => string,
      labelSaid: () => string
    ) => {
      if (!hasLabel) return;
      present[field]++;
      if (ok()) agree[field]++;
      else disagreements.push({ part: got.part, field, catalogue: catalogueSaid(), label: labelSaid() });
    };

    const printed = (rows: Measured[]) => rows.map((m) => `${m.value} @ ${m.conditions}`).join(" | ");
    const classes = (rows: Measured[]) => [...new Set(rows.map((m) => classOf(m.conditions)))].join(" | ");

    check(
      "vds",
      label.vds_v !== null,
      () => got.vds !== null && close(got.vds, label.vds_v as number),
      () => String(got.vds),
      () => String(label.vds_v)
    );
    check(
      "rdson",
      label.rdson_mohm !== null,
      () => carries(got.rdson, label.rdson_mohm as Measurement),
      () => printed(got.rdson),
      () => `${label.rdson_mohm?.value} @ ${label.rdson_mohm?.conditions}`
    );
    check(
      "id",
      label.id_a !== null,
      () => carries(got.id, label.id_a as Measurement),
      () => printed(got.id),
      () => `${label.id_a?.value} @ ${label.id_a?.conditions}`
    );
    /**
     * EVERY name, not any name.
     *
     * This asked `got.package.some(name => label.package.includes(name))` — does the
     * catalogue share AT LEAST ONE name with the label — and reported 0.998 while the
     * count questions it feeds were running at 0.45. Both numbers were correct. They
     * were measuring different things, and the flattering one was on the dashboard.
     *
     * A part offered as `LFPAK56; Power-SO8 (SOT669)` and filed under `LFPAK56` alone
     * is a perfect match under `some`, and it is missing from two of the three counts
     * it belongs in. The question "how many parts come in a Power-SO8" is answered by
     * the names that were NOT captured, so the metric has to be recall over the whole
     * set. Measured that way: 0.786 of names, and 0.525 of parts with a complete list.
     */
    check(
      "package",
      (label.package ?? []).length > 0,
      () => (label.package ?? []).every((name) => got.package.includes(name)),
      () => got.package.join("|"),
      () => (label.package ?? []).join("|")
    );
    check(
      "rdsonConditions",
      label.rdson_mohm !== null,
      () => inClass(got.rdson, label.rdson_mohm as Measurement),
      () => classes(got.rdson),
      () => classOf((label.rdson_mohm as Measurement).conditions)
    );
    // ID is graded on its class too, and it was not before. The ID class is where the
    // Tmb / Tamb distinction lives, and a part filed under free air when the datasheet
    // says mounting base competes against a heatsink it does not have.
    check(
      "idConditions",
      label.id_a !== null,
      () => inClass(got.id, label.id_a as Measurement),
      () => classes(got.id),
      () => classOf((label.id_a as Measurement).conditions)
    );
  }

  const rate = (field: (typeof fields)[number]) =>
    present[field] === 0 ? 0 : Number((agree[field] / present[field]).toFixed(4));

  return {
    parts: catalogue.length,
    agreementWithLabel: {
      vds: rate("vds"),
      rdson: rate("rdson"),
      id: rate("id"),
      package: rate("package"),
      rdsonConditions: rate("rdsonConditions"),
      idConditions: rate("idConditions")
    },
    disagreements
  };
}

if (import.meta.main) {
  const catalogue: Attributes[] = await Bun.file("data/attributes.json").json();
  const labels: GroundTruth[] = await Bun.file("data/groundtruth.json").json();
  const quality = grade(catalogue, labels);

  await Bun.write(
    "data/attributes-quality.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), ...quality }, null, 2)
  );

  console.error(`parts  ${quality.parts}\n`);
  console.error("agreement with a label it never saw:");
  for (const [field, value] of Object.entries(quality.agreementWithLabel)) {
    console.error(`  ${field.padEnd(16)} ${value}`);
  }
  console.error(`\n${quality.disagreements.length} disagreements -> data/attributes-quality.json`);
}
