/**
 * Run the eval and write the results the public page reads.
 *
 * Three of the four dimensions are measured here. The fourth (the scaling curve)
 * needs indices of different sizes and lives in its own tool.
 *
 *   retrieval   recall@k, MRR, nDCG over every indexed question. No model call, so
 *               it is cheap enough to run the whole set rather than a sample.
 *
 *   ablation    the same, for each of the three strategies. The number that matters
 *               is not which wins but by how much, because "we added a reranker"
 *               is a claim and "+31 points of recall@1" is a measurement.
 *
 *   refusal     over the 183 held-out parts, whose datasheets are not indexed. The
 *               trap is that 497 nearly identical ones ARE, so retrieval returns
 *               ten plausible tables for the wrong components every single time.
 *               A matched sample of indexed questions runs alongside, because a
 *               system that refuses everything scores 100% on refusal alone.
 *
 * Usage: INGEST_TOKEN=... bun tools/eval.ts <worker-url> [--sample N] [--reuse-retrieval]
 */

import { isDegenerate } from "../packages/doc-rag/src/degenerate";
import { grade } from "../packages/doc-rag/src/grade";
import { retrievalMetrics } from "../packages/doc-rag/src/metrics";
import { STRATEGIES, type Strategy } from "../packages/doc-rag/src/retrieve";
import type { Question } from "../packages/doc-rag/src/types";

const workerUrl = process.argv[2];
const token = process.env.INGEST_TOKEN;
const sampleArg = process.argv.indexOf("--sample");
const SAMPLE = sampleArg > -1 ? Number(process.argv[sampleArg + 1]) : 150;

/**
 * Which generator answers. Omitted, the Worker uses its production default.
 *
 * The override exists so a candidate model can be measured against the same
 * questions, the same evidence, and the same prompt as the incumbent, without
 * a deploy and without touching what production serves. Picking a generator by
 * reputation is how the current one got here.
 */
const modelArg = process.argv.indexOf("--model");
const GENERATOR: string | null = modelArg > -1 ? process.argv[modelArg + 1] : null;

/**
 * Reuse the retrieval block of a previous run.
 *
 * Legitimate only when the change under test cannot move a retrieval number.
 * The chunk-evidence fix is such a change: it alters which EXCERPTS reach the
 * generator and leaves the document ranking the metrics score byte-identical.
 * Re-measuring 5475 retrievals to reprint the same three tables would be
 * ceremony, not verification.
 */
const REUSE_RETRIEVAL = process.argv.includes("--reuse-retrieval");

/** Where the summary lands. Overridable so a run against an older build of the
 *  engine can be kept beside the current one instead of overwriting it. */
const outArg = process.argv.indexOf("--out");
const OUT = outArg > -1 ? process.argv[outArg + 1] : "data/eval-results.json";
const CASES_OUT = OUT.replace(/\.json$/, "-cases.json");

if (!workerUrl || !token) {
  console.error("usage: INGEST_TOKEN=... bun tools/eval.ts <worker-url> [--sample N] [--reuse-retrieval]");
  process.exit(1);
}

// A retrieve batch runs in parallel inside the Worker, so in-flight embeddings are
// BATCH x CONCURRENCY. At 40 x 4 that is 160 at once and Workers AI pushes back.
const RETRIEVE_BATCH = 20;
const ANSWER_BATCH = 6;
const CONCURRENCY = 3;

const questions: Question[] = await Bun.file("data/questions.json").json();
const indexed = questions.filter((q) => q.split === "indexed");
const holdout = questions.filter((q) => q.split === "holdout");

/** Deterministic sample. A random one would move the number between runs for no reason. */
function sample<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const stride = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * stride)]);
}

/**
 * Retry on Workers AI backpressure.
 *
 * The first run died two thirds of the way through with "3040: Capacity
 * temporarily exceeded". That is the platform saying slow down, not the system
 * being wrong, and a benchmark that throws away 40 minutes of work because an
 * embedding queue was briefly full is measuring the wrong thing. Backoff, and
 * report if it ever gives up.
 */
async function post<T>(path: string, body: unknown, attempt = 0): Promise<T> {
  const response = await fetch(`${workerUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });

  if (response.ok) return (await response.json()) as T;

  const text = await response.text();
  const transient = response.status >= 500 || response.status === 429;
  if (transient && attempt < 6) {
    await Bun.sleep(2 ** attempt * 1000 + Math.floor(Math.random() * 500));
    return post<T>(path, body, attempt + 1);
  }
  throw new Error(`${path}: HTTP ${response.status} after ${attempt + 1} attempts ${text}`);
}

/** Drive a batched endpoint with a fixed worker pool, preserving input order. */
async function pipeline<In, Out>(
  items: In[],
  size: number,
  run: (batch: In[]) => Promise<Out[]>,
  label: string
): Promise<Out[]> {
  const batches: In[][] = [];
  for (let at = 0; at < items.length; at += size) batches.push(items.slice(at, at + size));

  const results: Out[][] = new Array(batches.length);
  let cursor = 0;
  let done = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < batches.length) {
        const at = cursor++;
        results[at] = await run(batches[at]);
        done++;
        if (done % 10 === 0 || done === batches.length) {
          process.stderr.write(`\r  ${label}: ${done}/${batches.length} batches`);
        }
      }
    })
  );
  process.stderr.write("\n");
  return results.flat();
}

type RetrieveResult = { id: string; documents: string[]; symbols: string[]; ms: number };
type AnswerResult = {
  id: string;
  text: string;
  refused: boolean;
  retrieved: string[];
  timings: { retrieveMs: number; generateMs: number };
};

const byId = new Map(questions.map((q) => [q.id, q]));

// ── 1 + 2. Retrieval quality, per strategy (the ablation) ────────────────────

// No latency here on purpose. The retrieve endpoint runs a batch in parallel for
// throughput, so any per-question timing it reports is measured under concurrency.
// Latency is measured by tools/scale.ts, one question at a time.
const retrieval: Record<string, ReturnType<typeof retrievalMetrics>> = {};

if (REUSE_RETRIEVAL) {
  const previous = await Bun.file("data/eval-results.json").json();
  Object.assign(retrieval, previous.retrieval);
  console.error(`retrieval: reused from the run of ${previous.generatedAt}`);
} else {
  console.error(`retrieval: ${indexed.length} indexed questions x ${STRATEGIES.length} strategies`);
}

for (const strategy of REUSE_RETRIEVAL ? [] : STRATEGIES) {
  const results = await pipeline<Question, RetrieveResult>(
    indexed,
    RETRIEVE_BATCH,
    async (batch) => {
      const body = { strategy, questions: batch.map((q) => ({ id: q.id, question: q.question })) };
      const { results } = await post<{ results: RetrieveResult[] }>("/harness/retrieve", body);
      return results;
    },
    strategy
  );

  retrieval[strategy] = retrievalMetrics(
    results.map((r) => ({ ranked: r.documents, gold: byId.get(r.id)!.part }))
  );

  const m = retrieval[strategy];
  console.error(
    `  ${strategy.padEnd(13)} recall@1 ${m.recall[1].toFixed(3)} · recall@5 ${m.recall[5].toFixed(3)} · MRR ${m.mrr.toFixed(3)}`
  );
}

// ── 3. Answers and refusal, on the winning strategy ──────────────────────────
const best = [...STRATEGIES].sort((a, b) => retrieval[b].mrr - retrieval[a].mrr)[0] as Strategy;
console.error(`\nanswers: strategy=${best}, ${SAMPLE} indexed + ${SAMPLE} holdout questions`);

const answerSet = [...sample(indexed, SAMPLE), ...sample(holdout, SAMPLE)];

const answers = await pipeline<Question, AnswerResult>(
  answerSet,
  ANSWER_BATCH,
  async (batch) => {
    const body = {
      strategy: best,
      model: GENERATOR ?? undefined,
      questions: batch.map((q) => ({ id: q.id, question: q.question }))
    };
    const { results } = await post<{ results: AnswerResult[] }>("/harness/answer", body);
    return results;
  },
  "answer"
);

const graded = answers.map((a) => {
  const question = byId.get(a.id)!;
  return { ...grade(question, a), id: a.id, split: question.split, dimension: question.dimension, answer: a };
});

const on = (split: "indexed" | "holdout") => graded.filter((g) => g.split === split);
const rate = (subset: typeof graded, predicate: (g: (typeof graded)[number]) => boolean) =>
  subset.length ? Number((subset.filter(predicate).length / subset.length).toFixed(3)) : 0;

const answered = on("indexed");
const held = on("holdout");

/**
 * The number a customer decides on is not accuracy.
 *
 * Accuracy folds two failures a user experiences completely differently into one
 * figure. A system that hands an engineer a wrong resistance is worse than useless,
 * because he now has to check every value it gives him and might as well have read
 * the datasheet himself. A system that says "not in the excerpts, here is the page"
 * costs him one lookup and keeps his trust. Both read as a miss.
 *
 * So the bar is stated as two numbers that pull against each other:
 *
 *   precision  of the answers that carried a figure, how many were right.
 *              This is the trust number. It is the one that has to approach 1.
 *   coverage   how often a figure came back at all, rather than a refusal or a hedge.
 *              This is the usefulness number, and refusing everything is how a
 *              system games precision.
 *
 * Accuracy is still reported, because it is what was asked for and because a pair
 * of numbers invites picking the flattering one.
 */
const withFigure = answered.filter((g) => g.reason === "match" || g.reason === "wrong-value");
const precision = withFigure.length
  ? Number((withFigure.filter((g) => g.correct).length / withFigure.length).toFixed(3))
  : 0;
const coverage = answered.length ? Number((withFigure.length / answered.length).toFixed(3)) : 0;

/** A collapsed decode is a broken response, not a wrong one, and it is graded
 *  "no value" beside honest misses unless it is counted separately. */
const degenerate = graded.filter((g) => isDegenerate(g.answer.text));

/** Did the answer reproduce the polarity the datasheet printed? Graded nowhere,
 *  reported here, so a system that emits signs at random cannot hide inside the
 *  magnitude comparison the grader does. */
const signed = answered.filter((g) => g.signMatched !== null);

const summary = {
  generatedAt: new Date().toISOString(),
  corpus: {
    documents: new Set(indexed.map((q) => q.part)).size,
    heldOut: new Set(holdout.map((q) => q.part)).size,
    questions: questions.length
  },
  retrieval,
  best,
  generator: GENERATOR,
  answer: {
    sample: answered.length,
    precision,
    coverage,
    correct: rate(answered, (g) => g.correct),
    wrongValue: rate(answered, (g) => g.reason === "wrong-value"),
    noValue: rate(answered, (g) => g.reason === "no-value"),
    refusedWrongly: rate(answered, (g) => g.reason === "refused-wrongly"),
    degenerate: Number((degenerate.length / graded.length).toFixed(4)),
    signAgreement: signed.length
      ? Number((signed.filter((g) => g.signMatched).length / signed.length).toFixed(3))
      : null,
    byDimension: Object.fromEntries(
      ["vds", "rdson", "id", "package"].map((dimension) => {
        const subset = answered.filter((g) => g.dimension === dimension);
        return [dimension, { n: subset.length, correct: rate(subset, (g) => g.correct) }];
      })
    )
  },
  refusal: {
    sample: held.length,
    refused: rate(held, (g) => g.reason === "refused-correctly"),
    hallucinated: rate(held, (g) => g.reason === "hallucinated"),
    // Of the answers it invented, how many were even right? A high number here
    // would mean the model is reciting a datasheet it memorised in pretraining,
    // not reading one we gave it, and the whole benchmark would be measuring the
    // wrong thing.
    hallucinatedButCorrect: (() => {
      const invented = held.filter((g) => g.reason === "hallucinated");
      if (!invented.length) return 0;
      const near = invented.filter((g) => {
        const question = byId.get(g.id)!;
        return question.expected.kind === "numeric" && g.found?.startsWith(String(question.expected.value));
      });
      return Number((near.length / invented.length).toFixed(3));
    })()
  },
  latency: {
    retrieveP50Ms: percentile(answers.map((a) => a.timings.retrieveMs), 0.5),
    retrieveP95Ms: percentile(answers.map((a) => a.timings.retrieveMs), 0.95),
    generateP50Ms: percentile(answers.map((a) => a.timings.generateMs), 0.5),
    generateP95Ms: percentile(answers.map((a) => a.timings.generateMs), 0.95)
  }
};

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length * p)] ?? 0);
}

await Bun.write(OUT, JSON.stringify(summary, null, 2));
await Bun.write(
  CASES_OUT,
  JSON.stringify(
    graded.map((g) => ({
      id: g.id,
      split: g.split,
      dimension: g.dimension,
      correct: g.correct,
      reason: g.reason,
      found: g.found,
      signMatched: g.signMatched,
      degenerate: isDegenerate(g.answer.text),
      expected: byId.get(g.id)!.expected,
      text: g.answer.text.slice(0, 400)
    })),
    null,
    2
  )
);

const a = summary.answer;
console.error(`\ngenerator ${GENERATOR ?? "(worker default)"}`);
console.error(`answer   precision ${a.precision} · coverage ${a.coverage} · accuracy ${a.correct} (n=${a.sample})`);
console.error(`         degenerate ${a.degenerate} · sign agreement ${a.signAgreement}`);
console.error(`refusal  refused ${summary.refusal.refused} · hallucinated ${summary.refusal.hallucinated} (n=${summary.refusal.sample})`);
console.error(`\nwrote ${OUT} and ${CASES_OUT}`);
