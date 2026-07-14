/**
 * The planner turns a sentence into a query. It never turns a query into an answer.
 *
 * That split is the whole point. The model is good at language and bad at
 * arithmetic over 497 rows it cannot see; the catalogue is good at the arithmetic
 * and cannot read English. So the model gets one job — say what was asked for, as a
 * spec — and the answer is then computed, not generated. A number that reaches the
 * user has been counted, never written.
 *
 * The measured alternative: asked these questions directly, the shipped RAG path
 * answered 25 of 95 and got 2 right. It said "All 9 parts are offered in an LFPAK
 * package" when there are 38, because it counted the nine it could see. It was not
 * lying. It was reporting its evidence window and calling it the corpus.
 */

import { classOf } from "./contracts";
import type { QuerySpec } from "./catalog";
import type { Field } from "./catalog";

/** What the planner is told the corpus contains, so it cannot invent a package that
 *  is not in it. Derived from the catalogue (`vocabulary()`), never hand-written. */
export type Vocabulary = {
  packages: string[];
  ratings: number[];
  rdsonConditions: string[];
  idConditions: string[];
};

/** The planner's verdict. `lookup` means: this is a question about one document, so
 *  it belongs on the retrieval path, which is where it is good. */
export type Plan = { route: "catalog"; spec: QuerySpec } | { route: "lookup" } | { route: "unsupported" };

const FIELDS: Field[] = ["rdson", "id", "vds"];

export function plannerPrompt(question: string, vocab: Vocabulary): string {
  return `You translate a question about a catalogue of MOSFET datasheets into a query. You never answer the question.

The catalogue holds one row per part with these fields:
  vds       drain-source voltage rating, in volts
  rdson     maximum on-state resistance, in mOhm, quoted at several gate drives
  id        maximum continuous drain current, in amps, quoted under several conditions
  package   the package names the part is offered in

Answer with ONE JSON object, and nothing else:

  {"route": "catalog", "spec": {"op": "min"|"max"|"count", "field": "rdson"|"id"|"vds", "filters": {...}}}
      when the question is about the SET of parts: a superlative (lowest/highest/best), or a count.
      "field" is what to rank by, and is omitted for a count.
      filters may contain: "channel": "N"|"P", "vds": <number>, "package": "<name>", "conditions": "<string>"

  {"route": "lookup"}
      when the question is about ONE part and names it.

  {"route": "unsupported"}
      when it is neither, or asks for something the four fields above cannot express.

Only these package names exist: ${vocab.packages.join(", ")}
Only these voltage ratings exist: ${vocab.ratings.join(", ")}
The conditions rdson is quoted under: ${vocab.rdsonConditions.map((c) => `"${c}"`).join(", ")}
The conditions id is quoted under: ${vocab.idConditions.map((c) => `"${c}"`).join(", ")}

If the question states the measurement conditions, copy the matching one from those lists into "conditions" exactly. If it does not, omit "conditions".

QUESTION
${question}`;
}

/**
 * Read the plan, and reject anything that is not one.
 *
 * A spec is executed against the whole corpus, so a hallucinated field or a
 * misspelled package is not a bad answer, it is an exact answer to a question
 * nobody asked. Everything the model sends is checked against the schema and the
 * vocabulary, and a spec that fails the check becomes a refusal rather than a
 * best-effort guess.
 */
export function parsePlan(text: string, vocab: Vocabulary): Plan {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return { route: "unsupported" };

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { route: "unsupported" };
  }
  if (typeof raw !== "object" || raw === null) return { route: "unsupported" };

  const plan = raw as Record<string, unknown>;
  if (plan.route === "lookup") return { route: "lookup" };
  if (plan.route !== "catalog") return { route: "unsupported" };

  const spec = plan.spec;
  if (typeof spec !== "object" || spec === null) return { route: "unsupported" };
  const s = spec as Record<string, unknown>;

  if (s.op !== "min" && s.op !== "max" && s.op !== "count") return { route: "unsupported" };

  let field: Field | undefined;
  if (s.op !== "count") {
    if (typeof s.field !== "string" || !FIELDS.includes(s.field as Field)) return { route: "unsupported" };
    field = s.field as Field;
  }

  const raw_filters = (typeof s.filters === "object" && s.filters !== null ? s.filters : {}) as Record<
    string,
    unknown
  >;
  const filters: QuerySpec["filters"] = {};

  if (raw_filters.channel === "N" || raw_filters.channel === "P") filters.channel = raw_filters.channel;

  if (typeof raw_filters.vds === "number") {
    // A rating the corpus does not carry means the plan is about a different
    // corpus. Answering "0 parts" would be true and useless; refusing says why.
    if (!vocab.ratings.includes(Math.abs(raw_filters.vds))) return { route: "unsupported" };
    filters.vds = Math.abs(raw_filters.vds);
  }

  if (typeof raw_filters.package === "string") {
    const known = vocab.packages.find(
      (name) => name.toLowerCase() === (raw_filters.package as string).trim().toLowerCase()
    );
    if (!known) return { route: "unsupported" };
    filters.package = known;
  }

  if (typeof raw_filters.conditions === "string" && field !== "vds") {
    const pool = field === "id" ? vocab.idConditions : vocab.rdsonConditions;
    // Matched as a CLASS, not as a string. A question says "at VGS = 10 V and
    // Tj = 25 °C" and the corpus files that bench as "Tj = 25 °C; VGS = 10 V"; the
    // order the terms are written in is not part of the measurement. Comparing the
    // raw strings makes the planner miss the class it was handed, drop the filter,
    // and hedge across every gate drive — a real answer to a question nobody asked.
    const wanted = classOf(raw_filters.conditions);
    const known = pool.find((c) => classOf(c).toLowerCase() === wanted.toLowerCase());
    // An unknown condition string is dropped rather than refused: the catalogue
    // then answers PER class, which is the honest response to a question that did
    // not pin one, and strictly more informative than a refusal.
    if (known) filters.conditions = known;
  }

  return { route: "catalog", spec: { op: s.op, ...(field ? { field } : {}), filters } };
}
