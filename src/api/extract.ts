/**
 * Attribute extraction: the build step that makes set queries answerable.
 *
 * "Which 40 V part has the lowest RDS(on)?" cannot be answered by retrieval, and
 * not because retrieval is tuned badly. The answer is a property of all 497
 * documents, and the ten chunks a retriever returns are ten documents. Measured:
 * over 55 such questions the true winner's datasheet reached the model 6 times,
 * and of the ten questions the model answered WRONG, the winner was retrieved
 * exactly zero times. No prompt and no larger model fixes that. The information
 * was never in the context.
 *
 * So the corpus is read once, at ingest, into a table. A superlative is then
 * `ORDER BY`, a count is `COUNT`, and both are exact over all 497 rather than
 * plausible over ten. The model does the reading, which is what it is good at.
 * The arithmetic is done by code, which is what code is good at.
 *
 * ── Two rules this file exists to honour ────────────────────────────────────
 *
 * 1. It must NOT read the ground truth. `tools/groundtruth.ts` is the LABEL. An
 *    extractor that read it would make the eval a measurement of the system
 *    agreeing with itself. So the extractor reads what the SYSTEM has: the same
 *    chunks, retrieved by the same embeddings, through `searchWithin`. Its output
 *    is then graded against the label, and the disagreements are a real number
 *    with a real meaning (`tools/extract-attributes.ts` reports it).
 *
 * 2. It must carry the CONDITIONS. RDS(on) is quoted at a gate voltage, and this
 *    corpus quotes it at five different ones. A table that stored the value and
 *    dropped `VGS = 4.5 V` would let a query rank a part against another part's
 *    test bench. The conditions are part of the fact, not metadata about it.
 */

import { Hono } from "hono";
import { retriever } from "../engine/cloudflare";
import type { Env } from "../types";
// The row shape lives in `contracts.ts`, which imports nothing: `tools/` reads it,
// and a type import that transitively touched `Env` would drag workerd's globals
// into the Bun-side program. Same seam as `IngestChunk`, same reason.
import { classOf, cleanConditions, cleanPackages, type Attributes, type Measured } from "./contracts";
export type { Attributes };

const GENERATOR = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * TWO queries, embedded once each and reused for every part.
 *
 * One was not enough, and the failure was quiet: a single query for ratings and
 * ordering information together returned twelve chunks of ratings, and 74 of 497
 * parts came back with an EMPTY package list. The ordering table simply never made
 * the cut. The identifier path had already learned this exact lesson — a package
 * question needs the ordering chunk, and it is nowhere near the limiting values —
 * so the extraction asks for it separately rather than hoping one query straddles
 * both.
 */
const QUERIES = {
  ratings:
    "limiting values, drain-source voltage, drain-source on-state resistance at " +
    "several gate voltages, continuous drain current",
  ordering: "ordering information, type number, package name, package version, marking"
} as const;

/** Chunks per query. A datasheet is around 51 chunks after the boilerplate strip.
 *
 *  `ordering` was 4, and the ordering table is where the industry code (SOT1210) lives
 *  while the trade name (LFPAK33) also appears in the summary and the marking section.
 *  A part whose ordering table missed the cut therefore came back with the trade name
 *  and no code, which reads as a complete answer and silently drops the part from
 *  every count filtered on the code. Names captured at K=4: 0.786 of them. */
const K = { ratings: 12, ordering: 6 } as const;


/**
 * `continuous, not a pulsed or time-limited rating` is a product requirement, not
 * test knowledge. A buyer asking for drain current means the current the part can
 * carry indefinitely; the 5-second figure answers a question nobody asked. The
 * prompt names no part, no dimension of the test set, and no expected value.
 *
 * ── And it names no package either, now ─────────────────────────────────────
 *
 * It used to. To fix a recall problem — the model captured the trade name and dropped
 * the industry code — the prompt listed ten real examples of both kinds. Recall went
 * from 0.786 to 0.959, and the examples became an answer: PSMN9R5-30YLC came back with
 * ELEVEN packages, which is every name in that list, on a datasheet that prints three.
 * The model could not find the ordering table, so it recited the prompt.
 *
 * Measured against the PDF text itself, which is neither the model nor the label: the
 * catalogue named a package the document never prints on 6 of 497 parts. Small, and the
 * single failure this system exists to refuse — a name written from memory is
 * indistinguishable from a name that was read, which is the same argument the refusal
 * guard makes about a whole datasheet. An example in a prompt is a value the model can
 * emit, so a prompt that names the answers is a prompt that will sometimes be one.
 */
function prompt(part: string, excerpts: string[]): string {
  return `You are reading excerpts from ONE MOSFET datasheet. Extract its ratings and answer with JSON only.

Fields:
  "channel" "N" or "P". The first sentence of the datasheet says which: "N-channel enhancement mode Field-Effect Transistor". null if it does not.
  "vds"     the drain-source voltage rating in volts. Number, or null. An N-channel part's rating is POSITIVE; a P-channel part's is negative.
            A "-" standing alone in a value column means the datasheet does not specify THAT COLUMN. It is a blank cell, not a minus sign,
            and it never belongs to the number beside it. A row printed "-  -  60" states one value, and the value is 60.
  "rdson"   an ARRAY of EVERY maximum drain-source on-state resistance the datasheet quotes, one entry per set of conditions:
            [{"value": number, "unit": "mOhm", "conditions": "..."}, ...]
            A datasheet quotes this at more than one gate voltage. Both are true and BOTH must be listed. [] if none is stated.
            THE COLUMN MATTERS. This row prints its numbers in the order Min, Typ, Max. Take the MAX — the LAST of them.
            The first number is a MINIMUM on-state resistance, which is not a figure anyone can design against, and it is
            the one you will take by accident because it comes first.
  "id"      an ARRAY of every maximum CONTINUOUS drain current, one entry per set of conditions, same shape.
            Continuous means it carries this indefinitely. A rating that holds only for a limited time is a DIFFERENT figure and must not be listed.
            The same current is quoted at more than one temperature (25 °C and 100 °C are both common). List EVERY temperature, not the first one.
            If you do list a time-limited row, its conditions MUST carry the duration exactly as printed ("t <= 5 s").
            The time-limited row and the continuous row are printed at the SAME gate voltage and the SAME temperature, and
            the duration is the only thing that tells them apart. Drop it and a five-second rating becomes a permanent one.
  "package" EVERY name this part's package goes by, as an array of strings, and ONLY names PRINTED IN THE EXCERPTS ABOVE. [] if none is printed.
            A package has two kinds of name and a datasheet prints both, in different places:
              a trade name, used in the title and the general description
              an industry code, usually in the ordering table's column headed "Version"
            Both name the same physical package and a buyer searches by either, so list both WHEN BOTH APPEAR.
            Do NOT write a name you know from experience and cannot point to in the excerpts. If the
            excerpts print only one name for this package, list exactly that one. A name you supply
            from memory is indistinguishable from one you read, and it is wrong.

Copy each conditions string exactly as printed, including the gate voltage, the temperature symbol (Tj, Tmb and Tamb are different things and must not be confused), and any duration limit.

Answer with one JSON object and nothing else.

EXCERPTS
${excerpts.map((text, i) => `[${i + 1}]\n${text}`).join("\n\n")}`;
}

/** The model is asked for JSON and mostly complies, but a 70B model at temperature
 *  0 still occasionally wraps it in a fence or a sentence. Parse what is there
 *  rather than demanding what should be. A failure returns null and is COUNTED,
 *  never quietly turned into an empty row: an empty row would silently drop a part
 *  out of every superlative it should have won. */
export function parseAttributes(part: string, text: string): Attributes | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;

  const row = raw as Record<string, unknown>;

  // Normalised HERE, at the boundary where free text becomes a table row, not later
  // at the query. A row stored as `TO-236AB (SOT23)` is invisible to a count on
  // `SOT23`, and a condition string still carrying `Fig. 12` puts the part in a
  // condition class of its own where it is compared against nobody. See contracts.ts.
  const measured = (value: unknown, unit: string): Measured[] => {
    // A model asked for an array sometimes sends the single object anyway. Both are
    // read: rejecting the object would drop the part out of every comparison it
    // belongs in, which is a silent loss, and silence is the failure mode this whole
    // file exists to remove.
    const entries = Array.isArray(value) ? value : value !== null && typeof value === "object" ? [value] : [];
    const out: Measured[] = [];
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const m = entry as Record<string, unknown>;
      if (typeof m.value !== "number" || typeof m.conditions !== "string") continue;
      const conditions = cleanConditions(m.conditions);
      // Two rows in the same condition class are the same fact written twice. Keep
      // the more conservative figure: for a maximum rating, that is the larger one.
      const existing = out.find((have) => classOf(have.conditions) === classOf(conditions));
      if (existing) {
        if (Math.abs(m.value) > Math.abs(existing.value)) existing.value = m.value;
        continue;
      }
      out.push({ value: m.value, unit, conditions });
    }
    return out;
  };

  return {
    part,
    channel: row.channel === "N" || row.channel === "P" ? row.channel : null,
    vds: typeof row.vds === "number" ? row.vds : null,
    rdson: measured(row.rdson, "mΩ"),
    id: measured(row.id, "A"),
    package: cleanPackages(
      Array.isArray(row.package) ? row.package.filter((p): p is string => typeof p === "string") : []
    )
  };
}

export const extract = new Hono<{ Bindings: Env }>();

extract.post("/harness/extract", async (c) => {
  const expected = c.env.INGEST_TOKEN;
  if (!expected) return c.json({ error: "extraction is not configured" }, 503);
  const presented = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (presented !== expected) return c.json({ error: "unauthorized" }, 401);

  const { parts } = (await c.req.json()) as { parts: string[] };
  if (!Array.isArray(parts) || parts.length === 0) {
    return c.json({ error: "expected a non-empty array of parts" }, 400);
  }

  const search = retriever(c.env);
  const vectors = {
    ratings: await search.embed(QUERIES.ratings),
    ordering: await search.embed(QUERIES.ordering)
  };

  const results = [];
  for (const part of parts) {
    // Ratings and ordering information sit pages apart, and one query for both
    // returned twelve chunks of ratings and no ordering table for 74 of 497 parts.
    const [ratings, ordering] = await Promise.all([
      search.index.searchWithin(vectors.ratings, K.ratings, part),
      search.index.searchWithin(vectors.ordering, K.ordering, part)
    ]);
    const seen = new Set<string>();
    const chunks = [...ratings, ...ordering].filter((r) =>
      seen.has(r.chunk.id) ? false : (seen.add(r.chunk.id), true)
    );
    if (chunks.length === 0) {
      results.push({ part, attributes: null, reason: "no chunks in the index" });
      continue;
    }

    const response = (await c.env.AI.run(GENERATOR as keyof AiModels, {
      messages: [{ role: "user", content: prompt(part, chunks.map((r) => r.chunk.text)) }],
      // 800 was set when a row held ONE on-resistance and ONE current. The schema now
      // asks for every row a datasheet quotes, and a part with five gate drives and
      // two temperatures runs past 800 tokens mid-string. The JSON then ends in the
      // middle of a conditions value, fails to parse, and the part is dropped from the
      // catalogue — so it is missing from every count it belongs in, and the count is
      // an undercount that looks like an answer. 20 of 497 parts died this way.
      max_tokens: 1500,
      temperature: 0
    } as never)) as unknown as { response?: string };

    const text = response.response ?? "";
    const attributes = parseAttributes(part, text);
    results.push({
      part,
      attributes,
      // The whole answer, not a 200-character excerpt of it. The excerpt was cut at
      // exactly the length that makes a truncated JSON document and a complete one
      // look identical, so the failure could not be told apart from my own slice.
      ...(attributes ? {} : { reason: "unparseable", raw: text })
    });
  }

  return c.json({ results });
});
