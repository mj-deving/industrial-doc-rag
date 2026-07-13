/**
 * Pick the generator by measuring it.
 *
 * The incumbent got the job by being the obvious default, and it turned out to be
 * responsible for 21 of the 24 failures in the first full eval: it read the wrong
 * cell of a table it had been handed intact, it refused questions about documents
 * it had in front of it, and 1.7% of the time it collapsed into repeated tokens.
 * Retrieval was at recall@1 = 1.000 throughout. So the generator is the one part
 * of the system worth changing, and the way to change it is not to read model cards.
 *
 * Every candidate meets the same questions, the same retrieved evidence, the same
 * prompt, and the same grader. The only thing that varies is the model.
 *
 * This is a SCREEN, not the verdict. It runs a smaller sample than the full eval,
 * because two of the candidates take twenty seconds a question and screening all
 * seven at full size would take a day. The winner is then re-measured at full size
 * by tools/eval.ts, and it is that number that ships. The sample size is printed
 * next to every figure here for exactly that reason.
 *
 * Usage: INGEST_TOKEN=... bun tools/bakeoff.ts <worker-url> [--sample N]
 */

import { isDegenerate } from "../packages/doc-rag/src/degenerate";
import { grade } from "../packages/doc-rag/src/grade";
import type { Question } from "../packages/doc-rag/src/types";

const UNREADABLE = "__UNREADABLE_RESPONSE__";

const workerUrl = process.argv[2];
const token = process.env.INGEST_TOKEN;
const sampleArg = process.argv.indexOf("--sample");
const SAMPLE = sampleArg > -1 ? Number(process.argv[sampleArg + 1]) : 60;

if (!workerUrl || !token) {
  console.error("usage: INGEST_TOKEN=... bun tools/bakeoff.ts <worker-url> [--sample N]");
  process.exit(1);
}

/**
 * The field, and why each one is here.
 *
 * `@cf/openai/gpt-oss-120b` is listed by `wrangler ai models` and returns 404 on
 * this account, so it is named here rather than silently absent: a candidate that
 * could not be measured is a fact about the platform, not a candidate that lost.
 */
const CANDIDATES = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast", // the incumbent, and the control
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/zai-org/glm-5.2",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/moonshotai/kimi-k2.6",
  "@cf/google/gemma-4-26b-a4b-it"
];

const STRATEGY = "hybrid-rrf";
const BATCH = 2;
const CONCURRENCY = 4;

const questions: Question[] = await Bun.file("data/questions.json").json();
const byId = new Map(questions.map((q) => [q.id, q]));

/** Deterministic, so every candidate is asked the SAME questions. A random sample
 *  per candidate would make the comparison a coin toss with extra steps. */
function sample<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const stride = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * stride)]);
}

const indexed = sample(questions.filter((q) => q.split === "indexed"), SAMPLE);
const holdout = sample(questions.filter((q) => q.split === "holdout"), SAMPLE);
const askSet = [...indexed, ...holdout];

type AnswerResult = {
  id: string;
  text: string;
  refused: boolean;
  retrieved: string[];
  timings: { retrieveMs: number; generateMs: number };
};

async function post(model: string, batch: Question[], attempt = 0): Promise<AnswerResult[]> {
  const response = await fetch(`${workerUrl}/harness/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      strategy: STRATEGY,
      model,
      questions: batch.map((q) => ({ id: q.id, question: q.question }))
    })
  });

  if (response.ok) return ((await response.json()) as { results: AnswerResult[] }).results;

  const text = await response.text();
  // 404 is the platform saying this model does not exist here. Retrying it six
  // times with exponential backoff is just a slower way to learn the same thing.
  if (response.status === 404) throw new Error(`unavailable: HTTP 404 ${text.slice(0, 80)}`);
  if ((response.status >= 500 || response.status === 429) && attempt < 5) {
    await Bun.sleep(2 ** attempt * 1000 + Math.floor(Math.random() * 500));
    return post(model, batch, attempt + 1);
  }
  throw new Error(`HTTP ${response.status} ${text.slice(0, 120)}`);
}

async function run(model: string): Promise<AnswerResult[]> {
  const batches: Question[][] = [];
  for (let at = 0; at < askSet.length; at += BATCH) batches.push(askSet.slice(at, at + BATCH));

  const out: AnswerResult[][] = new Array(batches.length);
  let cursor = 0;
  let done = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < batches.length) {
        const at = cursor++;
        out[at] = await post(model, batches[at]);
        done++;
        process.stderr.write(`\r  ${model.padEnd(44)} ${done}/${batches.length}`);
      }
    })
  );
  process.stderr.write("\n");
  return out.flat();
}

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length * p)] ?? 0);
};

const results = [];

for (const model of CANDIDATES) {
  let answers: AnswerResult[];
  try {
    answers = await run(model);
  } catch (error) {
    console.error(`  ${model.padEnd(44)} ${(error as Error).message}`);
    results.push({ model, error: (error as Error).message });
    continue;
  }

  const graded = answers.map((a) => {
    const question = byId.get(a.id)!;
    return { ...grade(question, a), split: question.split, dimension: question.dimension, text: a.text };
  });

  const on = (split: string) => graded.filter((g) => g.split === split);
  const answered = on("indexed");
  const held = on("holdout");

  const unreadable = graded.filter((g) => g.text.includes(UNREADABLE)).length;
  const degenerate = graded.filter((g) => isDegenerate(g.text)).length;

  const withFigure = answered.filter((g) => g.reason === "match" || g.reason === "wrong-value");
  const round = (n: number) => Number(n.toFixed(3));

  const entry = {
    model,
    n: { indexed: answered.length, holdout: held.length },
    // The trust number: when it gives you a figure, is the figure right?
    precision: withFigure.length ? round(withFigure.filter((g) => g.correct).length / withFigure.length) : 0,
    // The usefulness number. Refusing everything is how a model games precision.
    coverage: answered.length ? round(withFigure.length / answered.length) : 0,
    accuracy: answered.length ? round(answered.filter((g) => g.correct).length / answered.length) : 0,
    refusedWrongly: answered.length
      ? round(answered.filter((g) => g.reason === "refused-wrongly").length / answered.length)
      : 0,
    refusesHoldout: held.length ? round(held.filter((g) => g.correct).length / held.length) : 0,
    degenerate: round(degenerate / graded.length),
    // Not a score. A candidate with any unreadable response is disqualified, because
    // the harness cannot tell what it said and the grader would call it cautious.
    unreadable: round(unreadable / graded.length),
    byDimension: Object.fromEntries(
      ["vds", "rdson", "id", "package"].map((d) => {
        const subset = answered.filter((g) => g.dimension === d);
        return [d, subset.length ? round(subset.filter((g) => g.correct).length / subset.length) : null];
      })
    ),
    generateP50Ms: percentile(answers.map((a) => a.timings.generateMs), 0.5),
    generateP95Ms: percentile(answers.map((a) => a.timings.generateMs), 0.95)
  };

  results.push(entry);
  console.error(
    `  precision ${entry.precision} · coverage ${entry.coverage} · accuracy ${entry.accuracy} · ` +
      `holdout ${entry.refusesHoldout} · soup ${entry.degenerate} · unread ${entry.unreadable} · ` +
      `p50 ${entry.generateP50Ms}ms\n`
  );
}

await Bun.write(
  "data/eval-models.json",
  JSON.stringify(
    { generatedAt: new Date().toISOString(), strategy: STRATEGY, sample: SAMPLE, results },
    null,
    2
  )
);

console.error("wrote data/eval-models.json");
