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
import { isDegenerate } from "../../packages/doc-rag/src/degenerate";
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

/**
 * What does a given model ACTUALLY return?
 *
 * This exists because the shipped Workers AI types describe one response shape and
 * the platform serves two, and four of seven candidates came back as an empty
 * string — which is the shape of a refusal, and would have won the refusal test
 * outright. I wrote a parser for the shape I assumed, it was wrong, and this
 * endpoint is what replaced assuming with looking. It stays: every new candidate
 * is a new chance for the response shape to be something else again.
 */
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
  const { questions, strategy, k, model, evidence, guard } = (await c.req.json()) as {
    questions: Ask[];
    strategy: Strategy;
    k?: number;
    model?: string;
    evidence?: boolean;
    /**
     * The identifier guard, which production runs with and the eval runs WITHOUT.
     *
     * With it on, a held-out part is refused deterministically — its datasheet is
     * not in the index, so no chunk of it can be retrieved, so the guard fires
     * every time. The refusal rate would be 1.0 by construction, and reporting
     * that as a result would be reporting the definition of the guard rather than
     * a measurement of anything. So the harness turns it off and measures what the
     * MODEL does when it alone has to notice that ten convincing excerpts are all
     * about the wrong part. That number is the honest one, and it is the number the
     * eval prints. The guarded number is derived alongside it, from the parts each
     * question actually retrieved.
     */
    guard?: boolean;
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

  /**
   * Token soup is a broken response, not a wrong one, and it is worth one retry.
   *
   * The incumbent collapses into repeated tokens ("seeded seeded uling Hlav") on
   * about 1.3% of calls — an fp8 quantisation artefact, not a reading error.
   *
   * A retry only helps if the collapse is transient, and `temperature: 0` says it
   * should not be: a deterministic decode returns the same garbage forever, and the
   * retry would be a no-op that merely looked like a fix. So it was measured rather
   * than assumed. BUK7K12-60E's package question, which produced soup in the eval,
   * was asked four more times through this endpoint and answered correctly four
   * times out of four. Temperature zero is not determinism on this platform, and the
   * collapse does not reproduce.
   *
   * Retrying a WRONG answer would be tuning until the benchmark agrees. Retrying a
   * BROKEN one is what any caller does when the wire returns garbage. The line
   * between them is `isDegenerate`, which fires on repetition rather than on content
   * and has not yet fired on a real answer.
   */
  const generateOnce = generate;
  const generateChecked = async (prompt: string): Promise<string> => {
    const first = await generateOnce(prompt);
    if (!isDegenerate(first)) return first;
    return generateOnce(prompt);
  };

  const results = [];
  for (const ask of questions) {
    const result = await answer(
      retriever(c.env),
      generateChecked,
      ask.question,
      strategy,
      k ?? 10,
      guard ?? false
    );
    results.push({
      id: ask.id,
      text: result.text,
      refused: result.refused,
      retrieved: result.retrieved,
      // Off by default: ten chunks per question is most of the payload, and a
      // 300-question run does not need them. On when a failure needs explaining,
      // because the alternative is inferring what the model saw.
      ...(evidence ? { evidence: result.evidence } : {}),
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
