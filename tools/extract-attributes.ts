/**
 * Read the corpus into a table, and measure what the reading is worth.
 *
 * The model reads each indexed datasheet through the system's own retrieval and
 * emits four facts. Those rows become the catalogue that answers set queries. The
 * rows are then GRADED against `data/groundtruth.json`, which the extractor never
 * sees, and the disagreement rate is reported rather than hidden: a catalogue is
 * only worth the extraction behind it, and a superlative computed over a table
 * with a wrong row is a confident wrong answer with an exact number attached.
 *
 * Two mechanisms, one corpus:
 *
 *   the LABEL       a deterministic parser reading the PDF's tables (tools/groundtruth.ts)
 *   the CATALOGUE   a 70B model reading the chunks the retriever returns (this file)
 *
 * Grading one against the other means something precisely because neither can see
 * the other. Where they disagree, one of them is wrong, and the disagreement is
 * printed with both values so a human can say which.
 *
 * Usage: INGEST_TOKEN=... bun tools/extract-attributes.ts <worker-url>
 */

import { isHoldout } from "./split";
import type { GroundTruth, Measurement } from "./groundtruth";
import { classOf, type Attributes, type Measured } from "../src/api/contracts";

const workerUrl = process.argv[2];
const token = process.env.INGEST_TOKEN;

if (!workerUrl || !token) {
  console.error("usage: INGEST_TOKEN=... bun tools/extract-attributes.ts <worker-url>");
  process.exit(1);
}

/** Parts per request. The Worker runs one retrieval and one generation per part,
 *  and a request has a CPU budget. */
const BATCH = 6;
/** Requests in flight. Workers AI answers a burst with "capacity temporarily
 *  exceeded", which is backpressure and not a wrong answer. */
const CONCURRENCY = 4;

const TOLERANCE = 0.01;

type Row = { part: string; attributes: Attributes | null; reason?: string; raw?: string };

async function post<T>(path: string, body: unknown, attempt = 0): Promise<T> {
  const response = await fetch(`${workerUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  if (response.ok) return (await response.json()) as T;
  const text = await response.text();
  if ((response.status >= 500 || response.status === 429) && attempt < 6) {
    await Bun.sleep(2 ** attempt * 1000);
    return post<T>(path, body, attempt + 1);
  }
  throw new Error(`${path}: HTTP ${response.status} after ${attempt + 1} attempts ${text}`);
}

const labels: GroundTruth[] = await Bun.file("data/groundtruth.json").json();
const indexed = labels.filter((l) => !isHoldout(l.part));

const batches: string[][] = [];
for (let at = 0; at < indexed.length; at += BATCH) {
  batches.push(indexed.slice(at, at + BATCH).map((l) => l.part));
}

const rows: Row[] = [];
for (let at = 0; at < batches.length; at += CONCURRENCY) {
  const wave = batches.slice(at, at + CONCURRENCY);
  const done = await Promise.all(
    wave.map((parts) => post<{ results: Row[] }>("/harness/extract", { parts }))
  );
  for (const { results } of done) rows.push(...results);
  console.error(`  ${rows.length}/${indexed.length}`);
}

// The catalogue is 497 model calls and it is written BEFORE anything is computed
// from it. The first version graded first and wrote after, and a null-dereference
// in the grader threw away the whole extraction on the last line. An expensive
// artifact is persisted the moment it exists, never after the analysis that might
// not survive.
const extracted = rows.filter((r) => r.attributes !== null);
await Bun.write(
  "data/attributes.json",
  JSON.stringify(
    extracted.map((r) => r.attributes),
    null,
    2
  )
);
console.error(`\nwrote data/attributes.json (${extracted.length} rows)`);

/**
 * The ones that failed, with what the model actually said.
 *
 * 20 parts came back unparseable on the previous run and the count was printed and the
 * REASON thrown away, so "20 unparseable" was a number nobody could act on. Every one
 * of those parts is absent from the catalogue, which means absent from every count it
 * belongs in, which is an undercount that looks like an answer. A failure you cannot
 * read is a failure you cannot fix.
 */
const failed = rows.filter((r) => r.attributes === null);
await Bun.write(
  "data/attributes-failures.json",
  JSON.stringify(
    failed.map((r) => ({ part: r.part, reason: r.reason ?? "unknown", raw: (r.raw ?? "").slice(0, 400) })),
    null,
    2
  )
);
if (failed.length > 0) console.error(`${failed.length} failed -> data/attributes-failures.json`);

// ── What the reading was worth ───────────────────────────────────────────────
const byPart = new Map(labels.map((l) => [l.part, l]));
const close = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * TOLERANCE;

type Disagreement = { part: string; field: string; catalogue: string; label: string };
const disagreements: Disagreement[] = [];
const agree = { vds: 0, rdson: 0, id: 0, package: 0, conditions: 0 };
const present = { vds: 0, rdson: 0, id: 0, package: 0, conditions: 0 };

for (const row of rows) {
  const label = byPart.get(row.part);
  if (!label || !row.attributes) continue;
  const got = row.attributes;

  // The checks are LAZY. The first version passed `ok` as a value, so
  // `close(got.rdson.value, label.rdson!.value)` was evaluated at the call site,
  // before the `hasLabel` guard inside the function could run, and it threw on the
  // first part with no on-resistance in its label. A guard inside a function does
  // not protect the arguments handed to it, and the `!` I wrote to quiet the
  // compiler is exactly the assertion that was false.
  const check = (
    field: keyof typeof agree,
    hasLabel: boolean,
    ok: () => boolean,
    catalogue: () => string,
    printed: () => string
  ) => {
    if (!hasLabel) return;
    present[field]++;
    if (ok()) agree[field]++;
    else disagreements.push({ part: row.part, field, catalogue: catalogue(), label: printed() });
  };

  /**
   * The catalogue holds EVERY row a datasheet quotes, and the label holds one. So
   * the question is not "do the two single values match" but "does the catalogue
   * carry a row in the label's condition class, with the label's value".
   *
   * That is the property the queries actually depend on. A part missing from the
   * VGS = 10 V class does not produce a wrong value; it vanishes from that
   * comparison, and the superlative returns the best of what is left. The winner is
   * then wrong, the number exact, and nothing looks broken.
   */
  const carries = (rows: Measured[], want: Measurement) =>
    rows.some(
      (m) => classOf(m.conditions) === classOf(want.conditions) && close(Math.abs(m.value), Math.abs(want.value))
    );
  const inClass = (rows: Measured[], want: Measurement) =>
    rows.some((m) => classOf(m.conditions) === classOf(want.conditions));

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
    () => got.rdson.map((m) => `${m.value} @ ${m.conditions}`).join(" | "),
    () => `${label.rdson_mohm?.value} @ ${label.rdson_mohm?.conditions}`
  );
  check(
    "id",
    label.id_a !== null,
    () => carries(got.id, label.id_a as Measurement),
    () => got.id.map((m) => `${m.value} @ ${m.conditions}`).join(" | "),
    () => `${label.id_a?.value} @ ${label.id_a?.conditions}`
  );
  check(
    "package",
    (label.package ?? []).length > 0,
    () => got.package.some((name) => (label.package ?? []).includes(name)),
    () => got.package.join("|"),
    () => (label.package ?? []).join("|")
  );

  // Reported separately from the value, because the two fail differently. A wrong
  // value is wrong. A MISSING condition class is a part quietly absent from a
  // comparison it belongs in, which is the failure that produces an exact wrong
  // winner rather than a visibly wrong number.
  check(
    "conditions",
    label.rdson_mohm !== null,
    () => inClass(got.rdson, label.rdson_mohm as Measurement),
    () => got.rdson.map((m) => classOf(m.conditions)).join(" | "),
    () => classOf((label.rdson_mohm as Measurement).conditions)
  );
}

const rate = (field: keyof typeof agree) =>
  present[field] === 0 ? 0 : Number((agree[field] / present[field]).toFixed(4));

const summary = {
  generatedAt: new Date().toISOString(),
  parts: rows.length,
  extracted: extracted.length,
  unparseable: rows.length - extracted.length,
  /** Agreement with a label the extractor cannot see. Not "accuracy": where the two
   *  disagree, the label is not automatically right. Three times in this project it
   *  was the label that was wrong. */
  agreementWithLabel: {
    vds: rate("vds"),
    rdson: rate("rdson"),
    id: rate("id"),
    package: rate("package"),
    rdsonConditions: rate("conditions")
  },
  disagreements: disagreements.length
};

await Bun.write("data/attributes-quality.json", JSON.stringify({ ...summary, disagreements }, null, 2));

console.error("");
console.error(`parts        ${summary.parts}`);
console.error(`extracted    ${summary.extracted}`);
console.error(`unparseable  ${summary.unparseable}`);
console.error("");
console.error("agreement with a label it never saw:");
for (const [field, value] of Object.entries(summary.agreementWithLabel)) {
  console.error(`  ${field.padEnd(16)} ${value}`);
}
console.error(`\n${disagreements.length} disagreements -> data/attributes-quality.json`);
