/**
 * The scaling curve: what changes as the corpus grows.
 *
 * The obvious reading of "scaling curve" is latency, and latency is the least
 * interesting axis: an approximate-nearest-neighbour index is built precisely so
 * that query time barely moves with corpus size, and if it turns out flat, that
 * is the finding and it gets reported as flat rather than dressed up.
 *
 * The axis that actually moves is RECALL. Five datasheets is not a retrieval
 * problem; the right answer is one of five. Five hundred near-identical MOSFET
 * datasheets is a retrieval problem, because the distractors are now documents
 * that differ from the target in a couple of digits of a part number, and a
 * vector model is worst at exactly those digits. So the same question, the same
 * embedding, the same strategy, gets harder for a reason that has nothing to do
 * with the model and everything to do with the shape of the corpus.
 *
 * Three sizes: 5, 100, and the full 497. Each is a real Vectorize index with real
 * vectors in it. Each is evaluated only on the questions whose gold document is
 * actually in it, because a question about a datasheet that is not there is not a
 * retrieval failure, it is a different measurement (that one is the refusal test).
 *
 * Usage: INGEST_TOKEN=... bun tools/scale.ts <worker-url> [--ingest]
 */

import { chunk } from "../packages/doc-rag/src/chunk";
import { retrievalMetrics } from "../packages/doc-rag/src/metrics";
import { isHoldout } from "./split";
import type { GroundTruth } from "./groundtruth";
import type { Question } from "../packages/doc-rag/src/types";

const workerUrl = process.argv[2];
const token = process.env.INGEST_TOKEN;
const doIngest = process.argv.includes("--ingest");

if (!workerUrl || !token) {
  console.error("usage: INGEST_TOKEN=... bun tools/scale.ts <worker-url> [--ingest]");
  process.exit(1);
}

/** Vectorize: $0.05 per 100M stored dimensions per month, first 10M free on Workers Paid. */
const STORED_PER_100M = 0.05;
const FREE_STORED_DIMS = 10_000_000;
const DIMENSIONS = 1024;

/** How many single questions to time end-to-end per index. */
const LATENCY_SAMPLE = 25;

/** Deterministic stride, so the timed questions are the same ones on every rerun. */
function sample<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const stride = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * stride)]);
}

const labels: GroundTruth[] = await Bun.file("data/groundtruth.json").json();
const questions: Question[] = await Bun.file("data/questions.json").json();

// Sorted, so "the first 5" is the same 5 on every machine and every rerun.
const indexedParts = labels
  .map((l) => l.part)
  .filter((part) => !isHoldout(part))
  .sort();

const SIZES = [
  { key: "s" as const, index: "idr-scale-s", parts: indexedParts.slice(0, 5) },
  { key: "m" as const, index: "idr-scale-m", parts: indexedParts.slice(0, 100) },
  { key: "l" as const, index: "idr-datasheets", parts: indexedParts }
];

/** Workers AI answers a burst of embeddings with "3040: Capacity temporarily
 *  exceeded". That is backpressure, not a wrong answer, so it is waited out. */
async function post<T>(path: string, body: unknown, attempt = 0): Promise<T> {
  const response = await fetch(`${workerUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });

  if (response.ok) return (await response.json()) as T;

  const text = await response.text();
  if ((response.status >= 500 || response.status === 429) && attempt < 6) {
    await Bun.sleep(2 ** attempt * 1000 + Math.floor(Math.random() * 500));
    return post<T>(path, body, attempt + 1);
  }
  throw new Error(`${path}: HTTP ${response.status} after ${attempt + 1} attempts ${text}`);
}

function chunksFor(part: string) {
  const proc = Bun.spawnSync(["pdftotext", "-layout", `corpus/${part}.pdf`, "-"]);
  const text = new TextDecoder().decode(proc.stdout);
  return chunk({ id: part, title: part, text }).map((c) => ({
    id: c.id,
    part: c.documentId,
    text: c.text,
    index: c.index
  }));
}

// ── Fill the two small indices (the big one is already ingested) ─────────────
if (doIngest) {
  for (const size of SIZES.filter((s) => s.key !== "l")) {
    const all = size.parts.flatMap(chunksFor);
    for (let at = 0; at < all.length; at += 64) {
      await post(`/ingest/chunks?index=${size.key}`, all.slice(at, at + 64));
    }
    console.error(`${size.index}: ${size.parts.length} parts, ${all.length} chunks`);
  }
  console.error("waiting 60s for Vectorize to process the upserts\n");
  await Bun.sleep(60_000);
}

// ── Measure ──────────────────────────────────────────────────────────────────
type RetrieveResult = { id: string; documents: string[]; ms: number };

/**
 * Both strategies, at every size, and the comparison IS the finding.
 *
 * The first version of this tool measured hybrid-rrf alone and produced a
 * perfectly flat 1.000 across all three sizes. That is not a scaling curve, it is
 * the same tautology printed three times: the symbol arm looks the part number up
 * by key, and a key lookup does not care how many neighbours it has.
 *
 * Dense is the arm that feels the corpus. At five datasheets there is nothing to
 * confuse; at 497 the distractors are documents that differ from the target in two
 * digits of a part number, which is exactly the token an embedding is worst at.
 * Running both shows what corpus growth costs a vector index and what it costs a
 * fused one.
 */
const MEASURED = ["dense", "hybrid-rrf"] as const;

async function measure(sizeKey: string, strategy: string, asks: Question[]) {
  const results: RetrieveResult[] = [];
  for (let at = 0; at < asks.length; at += 20) {
    const batch = asks.slice(at, at + 20);
    const { results: got } = await post<{ results: RetrieveResult[] }>("/harness/retrieve", {
      strategy,
      index: sizeKey,
      questions: batch.map((q) => ({ id: q.id, question: q.question }))
    });
    results.push(...got);
  }
  const gold = new Map(asks.map((q) => [q.id, q.part]));
  const metrics = retrievalMetrics(results.map((r) => ({ ranked: r.documents, gold: gold.get(r.id)! })));
  return { questions: results.length, recallAt1: metrics.recall[1], recallAt5: metrics.recall[5], mrr: metrics.mrr };
}

const curve = [];

for (const size of SIZES) {
  const inIndex = new Set(size.parts);
  // Only questions this index could possibly answer. A question about a datasheet
  // that is not in this index is not a retrieval miss, it is a refusal case, and
  // mixing the two would report a smaller index as worse than it is.
  const asks = questions.filter((q) => q.split === "indexed" && inIndex.has(q.part));

  const chunkCount = size.parts.reduce((sum, part) => sum + chunksFor(part).length, 0);
  const storedDims = chunkCount * DIMENSIONS;

  const byStrategy: Record<string, Awaited<ReturnType<typeof measure>>> = {};
  for (const strategy of MEASURED) byStrategy[strategy] = await measure(size.key, strategy, asks);

  // Latency is measured separately, one question per request, and timed from the
  // CLIENT. The `ms` the batched calls report is wall time under twenty parallel
  // in-flight embeddings, which is a throughput figure wearing a latency costume:
  // it tells you what the queue did, not what a user waits. This costs a minute
  // per index and is the only number here anyone would ever feel.
  const times: number[] = [];
  for (const ask of sample(asks, LATENCY_SAMPLE)) {
    const started = performance.now();
    await post("/harness/retrieve", {
      strategy: "hybrid-rrf",
      index: size.key,
      questions: [{ id: ask.id, question: ask.question }]
    });
    times.push(Math.round(performance.now() - started));
  }
  times.sort((a, b) => a - b);

  const billableDims = Math.max(0, storedDims - FREE_STORED_DIMS);
  const entry = {
    documents: size.parts.length,
    chunks: chunkCount,
    questions: byStrategy["dense"].questions,
    storedDimensions: storedDims,
    storageUsdPerMonth: Number(((billableDims / 100_000_000) * STORED_PER_100M).toFixed(4)),
    denseRecallAt1: byStrategy["dense"].recallAt1,
    denseRecallAt5: byStrategy["dense"].recallAt5,
    denseMrr: byStrategy["dense"].mrr,
    fusedRecallAt1: byStrategy["hybrid-rrf"].recallAt1,
    p50Ms: times[Math.floor(times.length * 0.5)] ?? 0,
    p95Ms: times[Math.floor(times.length * 0.95)] ?? 0
  };
  curve.push(entry);

  console.error(
    `${String(entry.documents).padStart(3)} docs · ${String(entry.questions).padStart(4)} q · ` +
      `dense recall@1 ${entry.denseRecallAt1.toFixed(3)} · fused ${entry.fusedRecallAt1.toFixed(3)} · ` +
      `p50 ${entry.p50Ms}ms p95 ${entry.p95Ms}ms · storage $${entry.storageUsdPerMonth}/mo`
  );
}

await Bun.write(
  "data/eval-scale.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      strategies: MEASURED,
      pricing: {
        note: "Vectorize storage: $0.05 per 100M stored dimensions/month, first 10M free on Workers Paid.",
        source: "https://developers.cloudflare.com/vectorize/platform/pricing/"
      },
      curve
    },
    null,
    2
  )
);

console.error("\nwrote data/eval-scale.json");
