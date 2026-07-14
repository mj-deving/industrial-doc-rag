/**
 * The write path onto the index.
 *
 * Text extraction happens on the client, not here, and that is not a shortcut:
 * `pdftotext -layout` is the same renderer the ground truth was parsed from, and
 * it cannot run in a Worker. Extracting differently here would mean the index and
 * the labels disagree about what the document says, and every such disagreement
 * would show up in the eval as a retrieval failure that no retriever could fix.
 *
 * So the Worker's job is narrow: embed the chunks it is handed, and upsert them.
 */

import { Hono } from "hono";
import { bindingFor, embed, type IndexSize, type VectorMeta } from "../engine/cloudflare";
import type { Env } from "../types";

/** Workers AI takes batches; 32 keeps a request well inside the CPU budget. */
const EMBED_BATCH = 32;

/** How far past a document's last chunk to sweep for the previous ingest's leftovers.
 *  The longest datasheet in this corpus chunked to 79 before boilerplate stripping and
 *  54 after, so the debris a re-chunk leaves is tens of ids, not hundreds. 80 covers a
 *  document that halves in size; it is slack, not a guess, and every id past the real
 *  end is a no-op delete that still costs a round trip to Vectorize. */
const OVERHANG = 80;

/** Vectorize's own ceiling on a single deleteByIds call. */
const DELETE_BATCH = 100;

export type IngestChunk = {
  id: string;
  part: string;
  text: string;
  index: number;
  /**
   * How many chunks this part has IN TOTAL, not how many are in this request.
   *
   * The prune below needs to know where the document ends. It cannot learn that
   * from the payload, because the payload is a fixed-size slice of a stream of
   * chunks from many parts and a long document spans several requests. Reading the
   * end from the payload gives a different, WRONG answer in each one — see the
   * comment on the prune. So the client, which is the only party that knows, says.
   */
  total: number;
};

/**
 * The ids to sweep after writing `chunks`: everything from each part's declared end
 * out to the overhang.
 *
 * The property that matters is that this depends ONLY on `total`, never on which
 * chunks the request happens to carry. Two concurrent requests holding different
 * halves of the same document must compute the same range, or one of them deletes
 * the other's writes. `ingest.test.ts` is what holds that.
 */
export function staleIds(chunks: IngestChunk[]): string[] {
  const ends = new Map(chunks.map((chunk) => [chunk.part, chunk.total]));
  return [...ends].flatMap(([part, total]) =>
    Array.from({ length: OVERHANG }, (_, i) => `${part}#${total + i}`)
  );
}

export const ingest = new Hono<{ Bindings: Env }>();

// Not "/ingest": v1 already owns that path and takes a PDF URL. This one takes
// chunks that were already extracted, which is a different operation and keeps
// its own name after v1 is deleted.
ingest.post("/ingest/chunks", async (c) => {
  const expected = c.env.INGEST_TOKEN;
  if (!expected) return c.json({ error: "ingest is not configured" }, 503);

  const presented = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (presented !== expected) return c.json({ error: "unauthorized" }, 401);

  const chunks = (await c.req.json()) as IngestChunk[];
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return c.json({ error: "expected a non-empty array of chunks" }, 400);
  }

  const size = (c.req.query("index") ?? "l") as IndexSize;
  if (!["s", "m", "l"].includes(size)) return c.json({ error: `unknown index "${size}"` }, 400);
  const target = bindingFor(c.env, size);

  let upserted = 0;
  for (let offset = 0; offset < chunks.length; offset += EMBED_BATCH) {
    const batch = chunks.slice(offset, offset + EMBED_BATCH);
    const vectors = await embed(
      c.env,
      batch.map((chunk) => chunk.text)
    );

    await target.upsert(
      batch.map((chunk, i) => ({
        id: chunk.id,
        values: vectors[i],
        metadata: { part: chunk.part, text: chunk.text, index: chunk.index } satisfies VectorMeta
      }))
    );
    upserted += batch.length;
  }

  // Re-ingesting a document must REPLACE it, not merge into it.
  //
  // Chunk ids are `PART#0, PART#1, ...`, so an upsert overwrites a chunk only if
  // the new render produces a chunk at the same index. The moment a document
  // chunks SHORTER than it did before — which is exactly what happened when
  // boilerplate stripping cut 31% of the text — every id past the new end survives
  // in the index, still embedded, still retrievable, and still holding the text the
  // strip was meant to remove. The index would then be a blend of two ingests, and
  // the eval run against it would measure a system that never existed.
  //
  // The end of the document is `total`, and it MUST come from the client.
  //
  // This used to read the end out of the payload — `max(index)` over the chunks in
  // this request — and that is wrong in the most destructive way available. The
  // client packs FIXED-SIZE requests out of a stream of chunks from many parts, and
  // sends them CONCURRENTLY, so a 50-chunk datasheet is split across two requests:
  // one holding chunks 0..6, another holding 7..49. The first request concluded the
  // document ended at 6 and deleted `#7..#86` — the very chunks the second request
  // had just written. Which of the two won depended on which HTTP response landed
  // first.
  //
  // It cost a third of the index: 25,536 chunks were upserted and 17,122 survived.
  // The eval kept running, against a corpus with 8,414 chunks missing at random, and
  // still scored 0.95 — so nothing failed loudly enough to be noticed. The one part I
  // happened to open by hand was missing the row the question asked about, and that
  // is the only reason I am reading this line rather than shipping.
  //
  // With `total`, every request computes the SAME range, so the prune is idempotent
  // and no ordering of the concurrent writes can delete a live chunk. Deleting ids
  // that do not exist is a no-op, so the overhang past the end costs nothing.
  const stale = staleIds(chunks);
  // Vectorize refuses more than 100 ids in one delete, so the sweep goes in batches.
  for (let offset = 0; offset < stale.length; offset += DELETE_BATCH) {
    await target.deleteByIds(stale.slice(offset, offset + DELETE_BATCH));
  }

  return c.json({ upserted, pruned: stale.length });
});
