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

/**
 * A ceiling, and it has to clear the reasoning models' scratchpad.
 *
 * This was 300, which is generous for an answer ("13 A at VGS = 10 V") and
 * invisible until a candidate that thinks before it speaks meets it. Qwen spent
 * all 300 tokens reasoning about a datasheet, returned `finish_reason: "length"`
 * with `content: null`, and the harness recorded an empty answer. Empty answers
 * grade as "no value" on the indexed half and as a refusal on the holdout half,
 * so the model would have scored a PERFECT refusal rate while producing nothing
 * at all, and the bake-off would have reported it as commendably cautious.
 *
 * Raising the ceiling costs the incumbent nothing: it stops at its stop token
 * after about twenty tokens either way.
 */
const MAX_TOKENS = 2000;

/** What a response the harness could not read is called, so that it can be
 *  counted instead of quietly scoring as caution. See `generate` below. */
export const UNREADABLE = "__UNREADABLE_RESPONSE__";

export const evalApi = new Hono<{ Bindings: Env }>();

evalApi.use("/harness/*", async (c, next) => {
  const expected = c.env.INGEST_TOKEN;
  if (!expected) return c.json({ error: "eval is not configured" }, 503);
  const presented = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (presented !== expected) return c.json({ error: "unauthorized" }, 401);
  await next();
});

type Ask = { id: string; question: string };

/** Temporary. What does a given model ACTUALLY return? The shipped types say one
 *  thing and four candidates returned an empty string, which is the shape of a
 *  refusal and would have won the refusal test outright. */
evalApi.post("/harness/raw", async (c) => {
  const { model, prompt } = (await c.req.json()) as { model: string; prompt?: string };
  const raw = await c.env.AI.run(model as keyof AiModels, {
    messages: [{ role: "user", content: prompt ?? "What is 2 + 2? Answer with the number only." }],
    max_tokens: MAX_TOKENS,
    temperature: 0
  } as never);
  return c.json({ model, keys: Object.keys(raw as object), raw });
});

/** Retrieval only. No generation, so this is cheap enough to run over all 2510 questions. */
evalApi.post("/harness/retrieve", async (c) => {
  const { questions, strategy, k, index } = (await c.req.json()) as {
    questions: Ask[];
    strategy: Strategy;
    k?: number;
    index?: IndexSize;
  };

  const search = retriever(c.env, index ?? "l");

  // Parallel across the batch. 5475 retrievals run sequentially would not fit the
  // request budget, and this endpoint exists for THROUGHPUT. The `ms` it reports
  // is therefore measured under concurrency and is not a latency figure: the
  // latency numbers come from the scaling tool, which asks one question at a time.
  const results = await Promise.all(
    questions.map(async (ask) => {
      const started = performance.now();
      const ranking = await retrieve(search, ask.question, strategy, k ?? 10);
      return {
        id: ask.id,
        documents: ranking.documents,
        symbols: ranking.symbols,
        ms: Math.round(performance.now() - started)
      };
    })
  );

  return c.json({ strategy, index: index ?? "l", results });
});

/**
 * Retrieval plus generation. Run on a sample: this one costs a model call per question.
 *
 * `model` overrides the generator for this request only. A candidate then meets
 * the same questions, the same retrieved evidence, and the same prompt as the
 * incumbent, and production keeps serving its default the whole time. Without
 * this the only way to compare two generators is to deploy one, which means the
 * comparison is a sequence of two different systems rather than one experiment.
 */
evalApi.post("/harness/answer", async (c) => {
  const { questions, strategy, k, model } = (await c.req.json()) as {
    questions: Ask[];
    strategy: Strategy;
    k?: number;
    model?: string;
  };

  const generator = model ?? GENERATOR;

  const generate = async (prompt: string): Promise<string> => {
    const response = (await c.env.AI.run(generator as keyof AiModels, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: MAX_TOKENS,
      // Deterministic decoding. A benchmark that samples is a benchmark whose
      // number moves when nothing changed.
      temperature: 0
    } as never)) as unknown;

    const text = textOf(response);

    // An unreadable response must never travel as an empty answer. Empty grades
    // as "no value" on the indexed half and as a refusal on the holdout half, so
    // a model the harness cannot read would post a perfect refusal rate and look
    // careful rather than mute. Two of the seven candidates did exactly this.
    // The sentinel is not a refusal and not a value, so it can only ever be
    // counted, and a candidate that emits it is disqualified rather than ranked.
    return text || UNREADABLE;
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

  return c.json({ strategy, generator, results });
});

/**
 * Workers AI does not have one response shape, it has two, and the shipped types
 * describe the first.
 *
 *   { response: "…" }                            llama, mistral
 *   { choices: [{ message: { content: "…" } }] } qwen, nemotron, glm — and these
 *                                                also carry a `response` key that
 *                                                is EMPTY, so reading `response`
 *                                                and stopping there returns ""
 *
 * An empty string is not a neutral failure here. It parses as "no value", the
 * grader files it beside honest misses on the indexed half, and on the holdout
 * half it looks like a refusal, so a model this function cannot read would score
 * a perfect refusal rate and lose only a little accuracy. It would look like a
 * cautious model rather than an unread one. I found this by dumping the raw
 * object, having first shipped a version of this function I had guessed.
 */
function textOf(raw: unknown): string {
  const shaped = raw as {
    response?: unknown;
    choices?: { message?: { content?: unknown } }[];
  };

  if (typeof shaped.response === "string" && shaped.response.trim()) return shaped.response;

  const content = shaped.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();

  return "";
}
