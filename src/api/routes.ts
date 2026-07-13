// The public read path.
//
// v2 replaced the Qdrant pipeline this file used to call. The engine now lives in
// packages/doc-rag and knows nothing about datasheets; src/engine binds it to
// Vectorize and Workers AI. What is left here is the HTTP shape.
//
// There is no public write route. Ingestion is token-guarded and lives in
// api/ingest.ts, because a public endpoint that accepts a PDF URL and embeds it is
// an invitation to have someone else's documents billed to this account.

import { Hono } from "hono";
import { answer } from "../../packages/doc-rag/src/answer";
import { consoleQuestions } from "../console/questions";
import { retriever } from "../engine/cloudflare";
import { badRequest } from "./errors";
import type { Env } from "../types";

const GENERATOR = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const STRATEGY = "hybrid-rrf" as const;
const K = 10;

/** Nexperia serves every datasheet at a deterministic URL keyed on the part number,
 *  so a citation links to the vendor's own copy and we republish nothing. */
const sourceUrl = (part: string) => `https://assets.nexperia.com/documents/data-sheet/${part}.pdf`;

export const api = new Hono<{ Bindings: Env }>();

api.post("/query", async (c) => {
  const body = await c.req.json<{ question?: string }>().catch(() => null);
  if (!body?.question) throw badRequest("Expected JSON body with question");

  const generate = async (prompt: string): Promise<string> => {
    const response = (await c.env.AI.run(GENERATOR as keyof AiModels, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0
    } as never)) as unknown as { response: string };
    return response.response ?? "";
  };

  const result = await answer(retriever(c.env), generate, body.question, STRATEGY, K);

  // One citation per datasheet, in retrieval order. Several chunks of the same
  // document usually make it into the evidence, and listing the same PDF five times
  // would be noise dressed as thoroughness.
  const seen = new Set<string>();
  const sources = result.retrieved
    .filter((part) => !seen.has(part) && (seen.add(part), true))
    .slice(0, 3)
    .map((part) => ({ part, sourceUrl: sourceUrl(part) }));

  return c.json({
    answer: result.text,
    refused: result.refused,
    sources: result.refused ? [] : sources,
    strategy: STRATEGY,
    generator: GENERATOR,
    timings: {
      retrieveMs: Math.round(result.timings.retrieveMs),
      generateMs: Math.round(result.timings.generateMs)
    }
  });
});

api.get("/health", async (c) => {
  const index = await c.env.VECTORIZE.describe();
  return c.json({
    ok: true,
    vectors: index.vectorsCount,
    // The config is a union: an index made from a preset reports the preset name
    // instead of its dimensions. Ours is explicit, but the type does not know that.
    dimensions: "dimensions" in index.config ? index.config.dimensions : null,
    embeddingModel: c.env.EMBEDDING_MODEL,
    generator: GENERATOR,
    strategy: STRATEGY
  });
});

api.get("/questions", (c) => c.json(consoleQuestions));
