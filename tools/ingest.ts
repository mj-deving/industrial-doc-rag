/**
 * Ingest the indexed half of the corpus.
 *
 * Extraction runs here, not in the Worker, because `pdftotext -layout` is the
 * same renderer the ground truth was parsed from and it cannot run on Workers.
 * Using a different extractor server-side would let the index and the labels
 * disagree about what a document says, and every disagreement would surface in
 * the eval as a retrieval failure that no retriever could ever fix. One document,
 * one rendering.
 *
 * Held-out parts are skipped, and the skip is not a filter written here: it is
 * `isHoldout` from tools/split.ts, the same function the question generator calls.
 * A single part leaking into the index would make the refusal measurement report
 * a hallucination where the system actually read a document.
 *
 * Usage:
 *   INGEST_TOKEN=... bun tools/ingest.ts <corpus-dir> <worker-url> [--dry-run]
 */

import { chunk } from "../packages/doc-rag/src/chunk";
import { isHoldout } from "./split";
import type { GroundTruth } from "./groundtruth";

const CONCURRENCY = 4;
const CHUNKS_PER_REQUEST = 64;
/** Vectorize's per-vector metadata cap. */
const METADATA_LIMIT = 10240;

const [corpusDir, workerUrl] = process.argv.slice(2);
const dryRun = process.argv.includes("--dry-run");

if (!corpusDir || (!workerUrl && !dryRun)) {
  console.error("usage: bun tools/ingest.ts <corpus-dir> <worker-url> [--dry-run]");
  process.exit(1);
}

const token = process.env.INGEST_TOKEN;
if (!token && !dryRun) {
  console.error("INGEST_TOKEN is not set");
  process.exit(1);
}

const labels: GroundTruth[] = await Bun.file("data/groundtruth.json").json();
const indexed = labels.map((label) => label.part).filter((part) => !isHoldout(part));

console.error(`${indexed.length} parts to index (${labels.length - indexed.length} held out)`);

type Batch = { part: string; chunks: { id: string; part: string; text: string; index: number }[] };

async function extract(part: string): Promise<Batch | null> {
  const pdf = `${corpusDir}/${part}.pdf`;
  const proc = Bun.spawn(["pdftotext", "-layout", pdf, "-"], { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0 || text.trim().length < 500) {
    console.error(`${part}: no usable text`);
    return null;
  }

  const chunks = chunk({ id: part, title: part, text }).map((c) => ({
    id: c.id,
    part: c.documentId,
    text: c.text,
    index: c.index
  }));

  // Vectorize rejects metadata over 10 KB. Catch it here, on the first bad chunk,
  // rather than 300 requests into a run that has already half-written the index.
  for (const c of chunks) {
    const bytes = new TextEncoder().encode(JSON.stringify(c)).length;
    if (bytes > METADATA_LIMIT) {
      throw new Error(`${c.id}: chunk metadata is ${bytes} bytes, over the ${METADATA_LIMIT} byte limit`);
    }
  }

  return { part, chunks };
}

let failed = 0;
let extractCursor = 0;
const extracted: Batch[] = [];

async function extractWorker(): Promise<void> {
  while (extractCursor < indexed.length) {
    const part = indexed[extractCursor++];
    const batch = await extract(part);
    if (batch) extracted.push(batch);
    else failed++;
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, extractWorker));

// Pack chunks into fixed-size requests. Requests, not parts, are the unit of
// work: a datasheet is ~60 chunks and the sizes vary, so batching per part would
// make every request a different length and the slowest one would set the pace.
const requests: Batch["chunks"][] = [];
let pending: Batch["chunks"] = [];
for (const batch of extracted) {
  for (const item of batch.chunks) {
    pending.push(item);
    if (pending.length >= CHUNKS_PER_REQUEST) {
      requests.push(pending);
      pending = [];
    }
  }
}
if (pending.length) requests.push(pending);

const totalChunks = requests.reduce((sum, r) => sum + r.length, 0);
console.error(`${extracted.length} parts read · ${totalChunks} chunks in ${requests.length} requests`);

if (dryRun) {
  console.error(`\ndone: ${extracted.length} parts, ${totalChunks} chunks (dry run, nothing upserted)`);
  process.exit(0);
}

let sent = 0;
let done = 0;
let sendCursor = 0;

async function sendWorker(): Promise<void> {
  while (sendCursor < requests.length) {
    const payload = requests[sendCursor++];
    const response = await fetch(`${workerUrl}/ingest/chunks`, {
      method: "POST",
      // The token goes in a header, never in the URL: a URL lands in logs, in
      // shell history, and in referrers.
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`ingest failed: HTTP ${response.status} ${await response.text()}`);
    }
    const { upserted } = (await response.json()) as { upserted: number };
    sent += upserted;
    done++;
    if (done % 20 === 0) console.error(`${done}/${requests.length} requests · ${sent} chunks`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, sendWorker));

console.error(`\ndone: ${extracted.length} parts, ${sent} chunks${failed ? `, ${failed} unreadable` : ""}`);
