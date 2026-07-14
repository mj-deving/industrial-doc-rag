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
import { answer, namedParts, REFUSAL_TOKEN } from "../../packages/doc-rag/src/answer";
import { withoutNames } from "../../packages/doc-rag/src/text";
import { consoleQuestions } from "../console/questions";
import { retriever } from "../engine/cloudflare";
import { explain, runQuery, vocabulary } from "./catalog";
import { parsePlan, plannerPrompt } from "./planner";
import { badRequest } from "./errors";
import attributes from "../../data/attributes.json";
import type { Attributes } from "./contracts";
import type { Env } from "../types";

const GENERATOR = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const STRATEGY = "hybrid-rrf" as const;
const K = 10;

/**
 * The catalogue, read at BUILD time, not per request.
 *
 * 497 rows is about 200 kB of JSON. It is bundled into the Worker rather than kept
 * in a database because a database would be infrastructure added to look serious: a
 * superlative over 497 rows is a loop, and the loop takes microseconds. At a hundred
 * thousand parts this becomes D1 and a real index. At 497 it is an array, and saying
 * so is more honest than hiding it behind a query engine.
 *
 * The consequence is that a refreshed extraction needs a redeploy, which is the same
 * contract the eval results file already has.
 */
const CATALOG = attributes as Attributes[];
const VOCAB = vocabulary(CATALOG);

/**
 * Package names are identifier-shaped, and the guard treats an identifier it cannot
 * retrieve as a held-out part. `LFPAK33` is not a part and never will be retrieved,
 * so the guard refused every question that named one. Handing it the corpus's own
 * package vocabulary is the fix at the root: the guard now knows what is not a
 * document.
 */
const NOT_PARTS = new Set(VOCAB.packages);

/** Nexperia serves every datasheet at a deterministic URL keyed on the part number,
 *  so a citation links to the vendor's own copy and we republish nothing. */
const sourceUrl = (part: string) => `https://assets.nexperia.com/documents/data-sheet/${part}.pdf`;

export const api = new Hono<{ Bindings: Env }>();

api.post("/query", async (c) => {
  const body = await c.req.json<{ question?: string }>().catch(() => null);
  if (!body?.question) throw badRequest("Expected JSON body with question");

  /**
   * The binding is untyped at runtime, and the declared type is a wish.
   *
   * `AI.run` is typed as returning `{ response: string }` and it does not always. It
   * threw `text.indexOf is not a function` inside the planner on the first live
   * request, from a call site the compiler had signed off on — the same way
   * `VECTORIZE.describe()` ships a type whose field names do not match what the V2
   * index returns (see `/health` below). This is the second time in this file that
   * trusting the declared shape over the runtime has produced a 500.
   *
   * So the coercion happens HERE, once, at the seam where an untyped binding meets
   * typed code, rather than in each of the three callers that assume a string.
   */
  const generate = async (prompt: string, maxTokens = 300): Promise<string> => {
    const raw = (await c.env.AI.run(GENERATOR as keyof AiModels, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0
    } as never)) as unknown;

    const said = (raw as { response?: unknown })?.response ?? raw;
    if (typeof said === "string") return said;
    // An object here is not a failure: the planner asks for JSON, and a binding that
    // hands back the parsed object rather than the text is giving us the same answer
    // in a different container. Re-serialising it lets the one parser read both.
    return said === undefined || said === null ? "" : JSON.stringify(said);
  };

  const question = body.question;

  /**
   * The route is decided by what the question NAMES, before any model is asked.
   *
   * A question that names a part is a question about a document, and the retrieval
   * path answers those at 99.8%. A question that names no part is a question about
   * the SET, and retrieval cannot answer it at all: the answer is a property of 497
   * documents and ten chunks are ten documents. Measured, before the catalogue
   * existed, the shipped path answered 25 of 95 such questions and got 2 right.
   *
   * Package names are subtracted first: `LFPAK33` is identifier-shaped and is not a
   * document, so a question naming one is not a lookup.
   *
   * They are subtracted from the TEXT, through the same `withoutNames` the guard uses,
   * and the router and the guard call it because they had a copy each. The copy here
   * subtracted TOKENS: `namedParts` turns `Power-SO8` into `SO8`, the package vocabulary
   * holds `Power-SO8`, and the two spellings never met — so the router saw an identifier
   * that was not a part, decided the question was a document lookup, and sent a question
   * about 139 datasheets down a path that reads ten. Fixing one copy of a normaliser and
   * leaving the other is the same bug this project has now shipped four times.
   */
  const identifiers = namedParts(withoutNames(question, NOT_PARTS));

  if (identifiers.length === 0) {
    const plan = parsePlan(await generate(plannerPrompt(question, VOCAB), 200), VOCAB);

    if (plan.route === "catalog") {
      const started = performance.now();
      const found = runQuery(plan.spec, CATALOG);
      const cited =
        found.kind === "extremum"
          ? found.parts
          : found.kind === "ambiguous-conditions"
            ? found.groups.flatMap((g) => g.parts)
            : [];

      return c.json({
        answer: explain(found),
        refused: found.kind === "empty",
        sources: cited.slice(0, 3).map((part) => ({ part, sourceUrl: sourceUrl(part) })),
        // Named so a reader can see WHICH machine answered. A number that came out of
        // the catalogue was counted; one that came out of the model was written.
        route: "catalog",
        // The SHAPE of the answer, not just its prose. An `ambiguous-conditions`
        // result names the winner of every condition class, which is the right thing
        // to say to a question that pinned none — and it is a non-answer to a question
        // that pinned one. A grader reading the prose finds the right part somewhere
        // in that list and calls it correct. Saying the kind out loud is what lets a
        // caller tell an answer from a hedge without parsing English.
        kind: found.kind,
        spec: plan.spec,
        strategy: STRATEGY,
        generator: GENERATOR,
        timings: { retrieveMs: 0, generateMs: Math.round(performance.now() - started) }
      });
    }

    /**
     * The catalogue cannot express it, and it names no part. REFUSE.
     *
     * This fell through to retrieval, on the reasoning that the model would decline
     * when the excerpts did not hold the answer. That reasoning is wrong, and the
     * first live probe showed exactly how. Asked for the part with the lowest total
     * gate charge — a field this catalogue does not carry — the fall-through answered:
     *
     *     "The part PSMN015-60BS has the lowest total gate charge, 17 nC."
     *
     * The excerpts DO hold gate charge. They hold it for ten parts. The claim is about
     * 497, and it was written with a number and two citations attached. That is the
     * failure this whole system exists to describe, rebuilt inside the router meant to
     * prevent it: a set question answered from an evidence window and reported as a
     * fact about the set.
     *
     * There is no honest retrieval answer to a corpus-wide question, so there is no
     * honest fall-through. A `lookup` verdict that names no part gets the same
     * treatment, because retrieval keys on the identifier that is not there.
     */
    return c.json({
      answer: REFUSAL_TOKEN,
      refused: true,
      sources: [],
      route: "catalog",
      kind: "unsupported",
      reason:
        "This question is about the corpus as a whole, and this catalogue holds only " +
        "V_DS, R_DS(on), I_D and package. It is not answerable from ten retrieved " +
        "excerpts, and answering it from them would be a guess with a citation.",
      strategy: STRATEGY,
      generator: GENERATOR,
      timings: { retrieveMs: 0, generateMs: 0 }
    });
  }

  const result = await answer(retriever(c.env), generate, question, STRATEGY, K, true, NOT_PARTS);

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
    route: "retrieval",
    strategy: STRATEGY,
    generator: GENERATOR,
    timings: {
      retrieveMs: Math.round(result.timings.retrieveMs),
      generateMs: Math.round(result.timings.generateMs)
    }
  });
});

api.get("/health", async (c) => {
  // The V2 index reports `{ dimensions, vectorCount, processedUpTo* }` flat, which is
  // what `wrangler vectorize info` prints and what the binding actually returns. The
  // shipped TYPE says `{ config: {...}, vectorsCount }`, with the plural in the wrong
  // place. It typechecks and throws. Trusting the type over the runtime is how this
  // endpoint went out returning a 500 that the compiler had signed off on.
  const details = (await c.env.VECTORIZE.describe()) as unknown as {
    dimensions: number;
    vectorCount: number;
  };

  return c.json({
    ok: true,
    vectors: details.vectorCount,
    dimensions: details.dimensions,
    embeddingModel: c.env.EMBEDDING_MODEL,
    generator: GENERATOR,
    strategy: STRATEGY
  });
});

api.get("/questions", (c) => c.json(consoleQuestions));
