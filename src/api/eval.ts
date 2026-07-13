/**
 * The eval harness endpoints.
 *
 * These are token-guarded and internal. The PUBLIC /eval page does not run the
 * eval: it reads a committed results file. An eval that reran on every page view
 * would cost money per visitor and would report a slightly different number every
 * time, which is the opposite of what a benchmark is for.
 *
 * They live in the Worker because that is where the Vectorize and Workers AI
 * bindings are, and because a measurement taken anywhere else would be measuring
 * a different system than the one the demo actually serves.
 */

import { Hono } from "hono";
import { answer } from "../../packages/doc-rag/src/answer";
import { retrieve, type Strategy } from "../../packages/doc-rag/src/retrieve";
import { retriever, type IndexSize } from "../engine/cloudflare";
import type { Env } from "../types";

const GENERATOR = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const evalApi = new Hono<{ Bindings: Env }>();

evalApi.use("/eval/*", async (c, next) => {
  const expected = c.env.INGEST_TOKEN;
  if (!expected) return c.json({ error: "eval is not configured" }, 503);
  const presented = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (presented !== expected) return c.json({ error: "unauthorized" }, 401);
  await next();
});

type Ask = { id: string; question: string };

/** Retrieval only. No generation, so this is cheap enough to run over all 2510 questions. */
evalApi.post("/eval/retrieve", async (c) => {
  const { questions, strategy, k, index } = (await c.req.json()) as {
    questions: Ask[];
    strategy: Strategy;
    k?: number;
    index?: IndexSize;
  };

  const search = retriever(c.env, index ?? "l");
  const results = [];
  for (const ask of questions) {
    const started = performance.now();
    const ranking = await retrieve(search, ask.question, strategy, k ?? 10);
    results.push({
      id: ask.id,
      documents: ranking.documents,
      symbols: ranking.symbols,
      ms: Math.round(performance.now() - started)
    });
  }

  return c.json({ strategy, index: index ?? "l", results });
});

/** Retrieval plus generation. Run on a sample: this one costs a model call per question. */
evalApi.post("/eval/answer", async (c) => {
  const { questions, strategy, k } = (await c.req.json()) as {
    questions: Ask[];
    strategy: Strategy;
    k?: number;
  };

  const generate = async (prompt: string): Promise<string> => {
    const response = (await c.env.AI.run(GENERATOR as keyof AiModels, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      // Deterministic decoding. A benchmark that samples is a benchmark whose
      // number moves when nothing changed.
      temperature: 0
    } as never)) as unknown as { response: string };
    return response.response ?? "";
  };

  const results = [];
  for (const ask of questions) {
    const result = await answer(retriever(c.env), generate, ask.question, strategy, k ?? 10);
    results.push({
      id: ask.id,
      text: result.text,
      refused: result.refused,
      retrieved: result.retrieved,
      timings: {
        retrieveMs: Math.round(result.timings.retrieveMs),
        generateMs: Math.round(result.timings.generateMs)
      }
    });
  }

  return c.json({ strategy, generator: GENERATOR, results });
});
