/**
 * Turn ground-truth labels into an eval question set.
 *
 * Every question is derived, never authored. A hand-written question set is a
 * set of questions someone thought to ask; a derived one asks about every fact
 * the corpus actually publishes, including the awkward ones.
 *
 * Two things travel with each question and both are load-bearing:
 *
 *   part   The document that contains the answer. This is the RETRIEVAL label,
 *          and it costs nothing: we know which PDF a fact came from because we
 *          parsed that PDF. Recall@k, MRR and nDCG need only this.
 *
 *   split  Whether the part's datasheet is in the index at all. A holdout
 *          question has a true answer that the system cannot legitimately know,
 *          so the correct behaviour is refusal. This is the only way to tell a
 *          confident hallucination apart from a correct retrieval.
 *
 * The conditions go INTO the question text. An RDS(on) question without them is
 * not a hard question, it is an ill-posed one: the same part reads 13.9 mOhm at
 * 25 C and 25 mOhm at 100 C, and grading either against the other is a coin
 * flip dressed up as a benchmark.
 *
 * Usage: bun tools/questions.ts data/groundtruth.json > data/questions.json
 */

import { isHoldout } from "./split";
import type { GroundTruth, Measurement } from "./groundtruth";
// The question shape belongs to the engine, not to this corpus. Importing it
// here is the seam: `tools/` is the datasheet adapter, and its whole job is to
// produce engine-typed Questions and Documents from Nexperia PDFs.
import type { Expected, Question } from "../packages/doc-rag/src/types";

type Dimension = "vds" | "rdson" | "id" | "package";

/** Relative tolerance on a numeric answer. The figure is quoted from a table,
 *  so this exists to absorb formatting (1 vs 1.0), not to forgive rounding. */
const TOLERANCE = 0.01;

function at(measurement: Measurement): string {
  return measurement.conditions ? ` at ${measurement.conditions}` : "";
}

export function questionsFor(truth: GroundTruth): Question[] {
  const split = isHoldout(truth.part) ? "holdout" : "indexed";
  const questions: Question[] = [];

  const add = (dimension: Dimension, question: string, expected: Expected) =>
    questions.push({ id: `${truth.part}:${dimension}`, part: truth.part, dimension, split, question, expected });

  if (truth.vds_v !== null) {
    add("vds", `What is the drain-source voltage rating (VDS) of the ${truth.part}?`, {
      kind: "numeric",
      value: truth.vds_v,
      unit: "V",
      tolerance: TOLERANCE
    });
  }

  if (truth.rdson_mohm) {
    add(
      "rdson",
      `What is the maximum on-state resistance RDS(on) of the ${truth.part}${at(truth.rdson_mohm)}?`,
      { kind: "numeric", value: truth.rdson_mohm.value, unit: truth.rdson_mohm.unit, tolerance: TOLERANCE }
    );
  }

  if (truth.id_a) {
    // Not "continuous". Where a part is rated only for t <= 5 s, no continuous
    // figure exists, and the adjective made the question ask for a row the
    // datasheet does not have while the label held one it does. The conditions
    // identify the row on their own; an adjective that is sometimes false does
    // not help, it just moves the question off the label.
    add("id", `What drain current (ID) is the ${truth.part} rated for${at(truth.id_a)}?`, {
      kind: "numeric",
      value: truth.id_a.value,
      unit: truth.id_a.unit,
      tolerance: TOLERANCE
    });
  }

  if (truth.package) {
    add("package", `Which package is the ${truth.part} supplied in?`, {
      kind: "text",
      value: truth.package
    });
  }

  return questions;
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: bun tools/questions.ts <groundtruth.json> > questions.json");
    process.exit(1);
  }

  const labels: GroundTruth[] = await Bun.file(path).json();
  const questions = labels.flatMap(questionsFor);

  const count = (predicate: (q: Question) => boolean) => questions.filter(predicate).length;
  const parts = new Set(questions.map((q) => q.part));
  const holdoutParts = new Set(questions.filter((q) => q.split === "holdout").map((q) => q.part));

  console.error(
    `${questions.length} questions over ${parts.size} parts ` +
      `(${holdoutParts.size} held out of the index)\n` +
      `  vds ${count((q) => q.dimension === "vds")} · ` +
      `rdson ${count((q) => q.dimension === "rdson")} · ` +
      `id ${count((q) => q.dimension === "id")} · ` +
      `package ${count((q) => q.dimension === "package")}\n` +
      `  indexed ${count((q) => q.split === "indexed")} · holdout ${count((q) => q.split === "holdout")}`
  );

  console.log(JSON.stringify(questions, null, 2));
}
