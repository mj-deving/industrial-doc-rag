/**
 * Identifier-free questions: the ones a part-number lookup cannot answer.
 *
 * Every question the existing eval asks names its part, so retrieval is a
 * primary-key read and recall@1 is 1.000. That number says nothing about the
 * question an engineer actually asks first: "which of these parts should I use?"
 * Those questions name no part. They name a CONSTRAINT and ask for the extremum
 * or the count under it, and the answer depends on all 497 documents rather than
 * on one.
 *
 * A vector index cannot answer them, and not because it is tuned badly. The
 * minimum over the ten chunks retrieval returns is not the minimum over the
 * corpus, and no k makes it so. This file builds the question set that measures
 * that gap.
 *
 * ── The trap this file exists to avoid ──────────────────────────────────────
 *
 * "Which 40 V part has the lowest RDS(on)?" is ILL-POSED, in exactly the way an
 * unconditioned single-part RDS(on) question was ill-posed in the first eval.
 * RDS(on) is quoted at a gate voltage: this corpus carries 150 distinct condition
 * strings that collapse to six classes (VGS = 10 V, 5 V, 4.5 V, -4.5 V, -10 V,
 * and one outlier at Tj = 175 °C). A part specified at VGS = 4.5 V will read
 * higher than one specified at 10 V for reasons that have nothing to do with
 * which part is better. Ranking across those classes ranks the test conditions.
 *
 * ID is worse, because the difference hides in one letter. `Tmb = 25 °C` holds
 * the MOUNTING BASE at 25 °C, which is a heatsink assumption; `Tamb = 25 °C` is
 * free air. The same die quotes a much larger current under the first. Comparing
 * them produces a ranking of thermal assumptions.
 *
 * So every comparison question pins the condition class and the candidate set is
 * restricted to the parts that publish under it. The question then has one right
 * answer, and it is computable.
 *
 * Usage: bun tools/questions-corpus.ts data/groundtruth.json > data/questions-corpus.json
 */

import { classOf, cleanPackages } from "../src/api/contracts";
import { isHoldout } from "./split";
import type { GroundTruth, Measurement } from "./groundtruth";

/** A question about the corpus rather than about a document. */
export type CorpusQuestion = {
  id: string;
  /** What shape of answer is being asked for. Drives grading and routing. */
  kind: "superlative-part" | "superlative-value" | "count";
  question: string;
  /** The winning part(s). Plural only on a tie, and a tie accepts any of them. */
  truthParts: string[];
  /** The numeric answer, for `superlative-value` and `count`. */
  truthValue: number | null;
  unit: string | null;
  /** How many indexed parts were in the filter set. A superlative over 2 parts is
   *  not much of a superlative; this is reported so a reader can judge. */
  candidates: number;
  /** The filter, kept so a failure can be re-derived without rerunning this. */
  filter: Record<string, string | number>;
};

/**
 * The condition class of a figure, for BOTH fields, and there is exactly one
 * definition of it: `classOf` in `src/api/contracts.ts`.
 *
 * It drops the drain current (`ID = 10 A` tracks the part's own rating and barely
 * moves on-resistance, and dropping it collapses 150 strings to six), it keeps `Tmb`
 * (mounting base, so a heatsink) apart from `Tamb` (free air), and it sorts the
 * terms, because `VGS = 10 V; Tmb = 25 °C` and `Tmb = 25 °C; VGS = 10 V` are the
 * same test bench printed two ways.
 *
 * These were two hand-written copies of that function, and only one of them sorted.
 * The truth came out right and the catalogue came out wrong, and the two could not
 * meet: the question asked about a class the catalogue did not have a name for. A
 * rule this load-bearing gets one implementation, and the truth generator and the
 * thing being graded both import it.
 */
export const rdsonClass = (m: Measurement): string => classOf(m.conditions);
export const idClass = (m: Measurement): string => classOf(m.conditions);

const channelName = (channel: "N" | "P") => (channel === "N" ? "N-channel" : "P-channel");

/** A P-channel part quotes -30 V. "Rated 30 V" is how an engineer says it. */
const ratingOf = (vds: number) => Math.abs(vds);

type Group = { key: string; filter: Record<string, string | number>; parts: GroundTruth[] };

/** Parts that publish the same measurement under the same conditions, so that the
 *  extremum among them is a fact about the parts and not about the test bench. */
function groupBy(
  labels: GroundTruth[],
  measurementOf: (label: GroundTruth) => Measurement | null,
  classOf: (m: Measurement) => string
): Group[] {
  const groups = new Map<string, Group>();
  for (const label of labels) {
    const m = measurementOf(label);
    if (!m || label.vds_v === null) continue;
    const condition = classOf(m);
    const key = `${label.channel}|${ratingOf(label.vds_v)}|${condition}`;
    const group = groups.get(key) ?? {
      key,
      filter: { channel: label.channel, vds: ratingOf(label.vds_v), conditions: condition },
      parts: []
    };
    group.parts.push(label);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Every part tied at the extremum. A tie is not a defect in the corpus, it is a
 *  fact about it, and a question graded against one arbitrary winner would mark a
 *  correct answer wrong. */
function extremum(
  parts: GroundTruth[],
  valueOf: (p: GroundTruth) => number,
  direction: "min" | "max"
): { value: number; winners: GroundTruth[] } {
  const values = parts.map(valueOf);
  const best = direction === "min" ? Math.min(...values) : Math.max(...values);
  return { value: best, winners: parts.filter((p) => valueOf(p) === best) };
}

/** A superlative over two parts is a coin flip dressed as a query. */
const MIN_CANDIDATES = 4;

export function corpusQuestions(all: GroundTruth[]): CorpusQuestion[] {
  // The truth is computed over the parts the system HAS. Grading a corpus-wide
  // superlative against 680 parts while 183 are deliberately held out would mark
  // the system wrong for not knowing documents we removed on purpose, and the
  // whole point of the holdout is that it must not know them.
  const indexed = all.filter((label) => !isHoldout(label.part));
  const questions: CorpusQuestion[] = [];

  // ── RDS(on): the lowest on-resistance under a fixed gate drive ──────────────
  for (const group of groupBy(indexed, (l) => l.rdson_mohm, rdsonClass)) {
    if (group.parts.length < MIN_CANDIDATES) continue;
    const { value, winners } = extremum(group.parts, (p) => p.rdson_mohm!.value, "min");
    const { channel, vds, conditions } = group.filter;
    const ask =
      `In this corpus, among the ${channelName(channel as "N" | "P")} parts rated ${vds} V ` +
      `whose R_DS(on) is specified at ${conditions}, `;

    questions.push({
      id: `corpus:rdson-min:${group.key}`,
      kind: "superlative-part",
      question: `${ask}which part has the lowest maximum R_DS(on)?`,
      truthParts: winners.map((w) => w.part),
      truthValue: value,
      unit: "mΩ",
      candidates: group.parts.length,
      filter: group.filter
    });

    questions.push({
      id: `corpus:rdson-min-value:${group.key}`,
      kind: "superlative-value",
      question: `${ask}what is the lowest maximum R_DS(on)?`,
      truthParts: winners.map((w) => w.part),
      truthValue: value,
      unit: "mΩ",
      candidates: group.parts.length,
      filter: group.filter
    });
  }

  // ── ID: the highest continuous current under a fixed thermal assumption ─────
  for (const group of groupBy(indexed, (l) => l.id_a, idClass)) {
    if (group.parts.length < MIN_CANDIDATES) continue;
    const { value, winners } = extremum(group.parts, (p) => Math.abs(p.id_a!.value), "max");
    const { channel, vds, conditions } = group.filter;

    questions.push({
      id: `corpus:id-max:${group.key}`,
      kind: "superlative-part",
      question:
        `In this corpus, among the ${channelName(channel as "N" | "P")} parts rated ${vds} V ` +
        `whose continuous I_D is specified at ${conditions}, which part carries the highest I_D?`,
      truthParts: winners.map((w) => w.part),
      truthValue: value,
      unit: "A",
      candidates: group.parts.length,
      filter: group.filter
    });
  }

  // ── Counts: no condition class, because a package is not a measurement ──────
  //
  // The label's package names go through the SAME normaliser the catalogue's do. Not a
  // convenience: the parser copies the PDF's non-breaking hyphen, so the raw label holds
  // `DFN2020MD‑6` for 16 parts and `DFN2020MD-6` for 32, and asks two questions about one
  // package, neither of which has the right answer. Both sides normalise or neither can be
  // compared — the same seam, and the same reasoning, as `classOf` for conditions.
  const byPackage = new Map<string, string[]>();
  for (const label of indexed) {
    for (const name of cleanPackages(label.package ?? [])) {
      byPackage.set(name, [...(byPackage.get(name) ?? []), label.part]);
    }
  }
  for (const [name, parts] of byPackage) {
    if (parts.length < MIN_CANDIDATES) continue;
    questions.push({
      id: `corpus:count-package:${name}`,
      kind: "count",
      question: `In this corpus, how many parts are offered in a ${name} package?`,
      truthParts: parts,
      truthValue: parts.length,
      unit: null,
      candidates: parts.length,
      filter: { package: name }
    });
  }

  // Voltage-class counts name no package, so they carry no token that could be
  // mistaken for a part number. They isolate the model's set-reasoning from the
  // identifier guard's false positives.
  const byRating = new Map<number, string[]>();
  for (const label of indexed) {
    if (label.vds_v === null) continue;
    const rating = ratingOf(label.vds_v);
    byRating.set(rating, [...(byRating.get(rating) ?? []), label.part]);
  }
  for (const [rating, parts] of byRating) {
    if (parts.length < MIN_CANDIDATES) continue;
    questions.push({
      id: `corpus:count-vds:${rating}`,
      kind: "count",
      question: `In this corpus, how many parts are rated ${rating} V?`,
      truthParts: parts,
      truthValue: parts.length,
      unit: null,
      candidates: parts.length,
      filter: { vds: rating }
    });
  }

  return questions.sort((a, b) => a.id.localeCompare(b.id));
}

if (import.meta.main) {
  const path = process.argv[2] ?? "data/groundtruth.json";
  const labels: GroundTruth[] = await Bun.file(path).json();
  const questions = corpusQuestions(labels);

  const byKind: Record<string, number> = {};
  for (const q of questions) byKind[q.kind] = (byKind[q.kind] ?? 0) + 1;
  console.error(`${questions.length} corpus questions:`, JSON.stringify(byKind));
  console.error(`ties: ${questions.filter((q) => q.kind !== "count" && q.truthParts.length > 1).length}`);

  console.log(JSON.stringify(questions, null, 2));
}
