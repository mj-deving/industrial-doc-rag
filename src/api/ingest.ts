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
import { embed, type VectorMeta } from "../engine/cloudflare";
import type { Env } from "../types";

/** Workers AI takes batches; 32 keeps a request well inside the CPU budget. */
const EMBED_BATCH = 32;

export type IngestChunk = {
  id: string;
  part: string;
  text: string;
  index: number;
};

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

  let upserted = 0;
  for (let offset = 0; offset < chunks.length; offset += EMBED_BATCH) {
    const batch = chunks.slice(offset, offset + EMBED_BATCH);
    const vectors = await embed(
      c.env,
      batch.map((chunk) => chunk.text)
    );

    await c.env.VECTORIZE.upsert(
      batch.map((chunk, i) => ({
        id: chunk.id,
        values: vectors[i],
        metadata: { part: chunk.part, text: chunk.text, index: chunk.index } satisfies VectorMeta
      }))
    );
    upserted += batch.length;
  }

  return c.json({ upserted });
});
