/**
 * The catalogue: set queries answered by arithmetic over all 497 rows.
 *
 * Retrieval hands a model ten chunks. A superlative is a property of the whole
 * corpus, so ten chunks cannot contain it, and the measurement says so plainly:
 * over 55 superlative questions the winning datasheet reached the model 6 times,
 * and of the ten it answered wrong, zero. The model was not sloppy. It was
 * answering a question about 497 documents from ten.
 *
 * So the corpus is read once into a table (`api/extract.ts`), and a superlative
 * becomes `ORDER BY`, a count becomes `COUNT`. The model still does the language,
 * turning a sentence into a query spec. The code does the arithmetic. Neither is
 * asked to do the other's job.
 *
 * ── The one rule ────────────────────────────────────────────────────────────
 *
 * A comparison across measurement conditions is not a comparison. This corpus
 * quotes RDS(on) at five different gate drives, and a part specified at
 * VGS = 4.5 V reads higher than the same die at 10 V for reasons that have nothing
 * to do with which part is better. ID is worse: `Tmb = 25 °C` holds the mounting
 * base at 25 °C, which assumes a heatsink, and `Tamb = 25 °C` is free air.
 *
 * So a superlative over a measured field REQUIRES a condition class. When the
 * question does not name one, the honest answer is not a guess and it is not a
 * refusal either: it is the extremum in EACH class, labelled. That is what an
 * engineer would say out loud, and `AMBIGUOUS_CONDITIONS` is how this file says it.
 */

import { classOf, type Attributes } from "./contracts";

export type Field = "rdson" | "id" | "vds";

export type QuerySpec = {
  op: "min" | "max" | "count";
  /** Which measured field to rank by. Ignored for `count`. */
  field?: Field;
  filters: {
    channel?: "N" | "P";
    /** The voltage class, unsigned: an engineer says "a 30 V part" for a -30 V one. */
    vds?: number;
    package?: string;
    /** The condition class, e.g. `VGS = 10 V; Tj = 25 °C`. Required for a min/max
     *  over `rdson` or `id`; meaningless for `vds`, which has no test conditions. */
    conditions?: string;
  };
};

export type CatalogResult =
  | { kind: "count"; count: number; filters: QuerySpec["filters"] }
  | {
      kind: "extremum";
      op: "min" | "max";
      field: Field;
      value: number;
      unit: string;
      /** Every part tied at the extremum. A tie is a fact about the corpus. */
      parts: string[];
      candidates: number;
      conditions: string | null;
    }
  /** The question ranks a measured field but names no conditions, and the corpus
   *  publishes it under several. Answered per class rather than guessed. */
  | {
      kind: "ambiguous-conditions";
      op: "min" | "max";
      field: Field;
      groups: { conditions: string; value: number; unit: string; parts: string[]; candidates: number }[];
    }
  | { kind: "empty"; filters: QuerySpec["filters"] };

/**
 * One part's claim to one comparison: a value, and the class it was measured in.
 *
 * A part contributes SEVERAL of these for a measured field, because a datasheet
 * quotes on-resistance at more than one gate drive and the part legitimately
 * competes in each of those comparisons. It contributes one for `vds`, which has no
 * test conditions.
 *
 * The value is absolute: a P-channel part carries -8.8 A, and "the highest current"
 * means the largest magnitude, not the largest signed number.
 */
type Candidate = { part: string; value: number; conditions: string | null };

function candidatesOf(rows: Attributes[], field: Field): Candidate[] {
  if (field === "vds") {
    return rows
      .filter((row) => row.vds !== null)
      .map((row) => ({ part: row.part, value: Math.abs(row.vds as number), conditions: null }));
  }
  return rows.flatMap((row) =>
    row[field].map((m) => ({ part: row.part, value: Math.abs(m.value), conditions: classOf(m.conditions) }))
  );
}

function unitOf(field: Field): string {
  return field === "vds" ? "V" : field === "rdson" ? "mΩ" : "A";
}

/** Loose on spelling, strict on meaning: `LFPAK56` and `lfpak56` are one package,
 *  `Tmb` and `Tamb` are two conditions. */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Exported so the eval can ask which rows a query COMPETED, using the query's own
 *  predicate rather than a second copy of it. A superlative that returns the wrong part
 *  has two possible causes and they need different fixes: the arithmetic picked the
 *  wrong row from the right pool, or the right row was never in the pool because the
 *  model did not read it. Reimplementing this predicate in the eval would let those two
 *  drift apart, and the eval would then measure its own copy. */
export function matches(row: Attributes, filters: QuerySpec["filters"]): boolean {
  if (filters.channel !== undefined) {
    // Read from the datasheet's first sentence. It used to be DERIVED from the sign of
    // VDS — a P-channel part quotes a negative rating — and then the model read the
    // em-dash in an empty Min column as a minus sign on 67 N-channel parts, which
    // silently moved every one of them into the P-channel half of the corpus. The sign
    // is still the fallback for a row written before the field existed, and only that.
    const channel = row.channel ?? (row.vds === null ? null : row.vds < 0 ? "P" : "N");
    if (channel !== filters.channel) return false;
  }
  if (filters.vds !== undefined) {
    if (row.vds === null || Math.abs(row.vds) !== filters.vds) return false;
  }
  if (filters.package !== undefined) {
    if (!row.package.some((name) => same(name, filters.package as string))) return false;
  }
  return true;
}

export function runQuery(spec: QuerySpec, rows: Attributes[]): CatalogResult {
  const filtered = rows.filter((row) => matches(row, spec.filters));

  if (spec.op === "count") {
    return { kind: "count", count: filtered.length, filters: spec.filters };
  }

  const field = spec.field ?? "rdson";
  const all = candidatesOf(filtered, field);
  if (all.length === 0) return { kind: "empty", filters: spec.filters };

  /** Every part tied at the extremum, deduplicated: a part that quotes the same
   *  figure twice is one winner, not two. */
  const pick = (candidates: Candidate[]) => {
    const best =
      spec.op === "min"
        ? Math.min(...candidates.map((c) => c.value))
        : Math.max(...candidates.map((c) => c.value));
    return {
      value: best,
      parts: [...new Set(candidates.filter((c) => c.value === best).map((c) => c.part))],
      candidates: new Set(candidates.map((c) => c.part)).size
    };
  };

  // `vds` has no test conditions, so it can be ranked directly.
  if (field === "vds") {
    return { kind: "extremum", op: spec.op, field, unit: unitOf(field), conditions: null, ...pick(all) };
  }

  if (spec.filters.conditions !== undefined) {
    const wanted = classOf(spec.filters.conditions);
    const inClass = all.filter((c) => c.conditions !== null && same(c.conditions, wanted));
    if (inClass.length === 0) return { kind: "empty", filters: spec.filters };
    return {
      kind: "extremum",
      op: spec.op,
      field,
      unit: unitOf(field),
      conditions: wanted,
      ...pick(inClass)
    };
  }

  // No conditions named, and the field is measured. Answer per class rather than
  // silently ranking a 4.5 V spec against a 10 V one.
  const classes = new Map<string, Candidate[]>();
  for (const candidate of all) {
    if (candidate.conditions === null) continue;
    classes.set(candidate.conditions, [...(classes.get(candidate.conditions) ?? []), candidate]);
  }
  if (classes.size === 0) return { kind: "empty", filters: spec.filters };
  if (classes.size === 1) {
    const [conditions, candidates] = [...classes][0];
    return { kind: "extremum", op: spec.op, field, unit: unitOf(field), conditions, ...pick(candidates) };
  }
  return {
    kind: "ambiguous-conditions",
    op: spec.op,
    field,
    groups: [...classes]
      .map(([conditions, candidates]) => ({ conditions, unit: unitOf(field), ...pick(candidates) }))
      .sort((a, b) => b.candidates - a.candidates)
  };
}

/**
 * The answer, written from the result rather than generated from it.
 *
 * No model sees this. A number that reaches the user has been counted, and the
 * sentence around it is a template, so the sentence cannot disagree with the
 * number. Everything the RAG path got wrong on these questions it got wrong by
 * writing a number: "All 9 parts are offered in an LFPAK package" is a fluent
 * sentence about a count of nine, and the count is thirty-eight.
 */
export function explain(result: CatalogResult): string {
  const list = (parts: string[]) =>
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const named = (filters: QuerySpec["filters"]) => {
    const terms: string[] = [];
    if (filters.channel) terms.push(`${filters.channel}-channel`);
    if (filters.vds !== undefined) terms.push(`rated ${filters.vds} V`);
    if (filters.package) terms.push(`in a ${filters.package} package`);
    return terms.length > 0 ? ` ${terms.join(", ")}` : "";
  };
  const label = (field: Field) => (field === "rdson" ? "R_DS(on)" : field === "id" ? "I_D" : "V_DS");
  const superlative = (op: "min" | "max", field: Field) =>
    `${op === "min" ? "lowest" : "highest"} ${label(field)}`;

  switch (result.kind) {
    case "count":
      return `${result.count} part${result.count === 1 ? "" : "s"} in this corpus${named(result.filters)}.`;

    case "extremum": {
      const where = result.conditions ? `, specified at ${result.conditions},` : "";
      return (
        `Of the ${result.candidates} parts in this corpus${where} the ${superlative(result.op, result.field)} ` +
        `is ${result.value} ${result.unit}: ${list(result.parts)}.`
      );
    }

    case "ambiguous-conditions": {
      // The question did not name a gate drive, and this corpus quotes the figure
      // under several. Ranking across them would rank the test bench, so each class
      // is answered. An engineer asked this way would say the same thing.
      const lines = result.groups.map(
        (g) =>
          `at ${g.conditions}: ${g.value} ${g.unit} (${list(g.parts)}, of ${g.candidates} parts)`
      );
      return (
        `${label(result.field)} is quoted under different conditions in this corpus, and they are not ` +
        `comparable. The ${superlative(result.op, result.field)} in each:\n` +
        lines.map((line) => `  ${line}`).join("\n")
      );
    }

    case "empty":
      return "NOT_IN_CORPUS";
  }
}

/** The catalogue's own vocabulary, so the planner can be told what exists rather
 *  than inventing a package that is not in the corpus. Derived from the rows, never
 *  hand-written, so it cannot go stale. */
export function vocabulary(rows: Attributes[]) {
  const packages = new Set<string>();
  const ratings = new Set<number>();
  const conditions = { rdson: new Set<string>(), id: new Set<string>() };

  for (const row of rows) {
    for (const name of row.package) packages.add(name);
    if (row.vds !== null) ratings.add(Math.abs(row.vds));
    for (const field of ["rdson", "id"] as const) {
      for (const m of row[field]) conditions[field].add(classOf(m.conditions));
    }
  }

  return {
    packages: [...packages].sort(),
    ratings: [...ratings].sort((a, b) => a - b),
    rdsonConditions: [...conditions.rdson].sort(),
    idConditions: [...conditions.id].sort()
  };
}
