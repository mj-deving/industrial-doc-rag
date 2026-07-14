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

import type { IngestChunk } from "../src/api/ingest";
import { chunk } from "../packages/doc-rag/src/chunk";
import { prepare } from "../packages/doc-rag/src/prepare";
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

// The wire type, imported rather than restated. It used to be a hand-copy that
// omitted `total`, so the payload carried a field the type said was not there and
// nothing would have caught its removal.
type Batch = { part: string; chunks: IngestChunk[] };

async function extract(part: string): Promise<Batch | null> {
  const pdf = `${corpusDir}/${part}.pdf`;
  const proc = Bun.spawn(["pdftotext", "-layout", pdf, "-"], { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0 || text.trim().length < 500) {
    console.error(`${part}: no usable text`);
    return null;
  }

  // Strip the boilerplate and bind each table row to its symbol BEFORE chunking.
  // The chunker stays generic; the vendor's page furniture is an ingest concern.
  // The ground truth is parsed from the raw render, not from this — the label must
  // come from the document, not from my cleanup of it, or a bug in the cleanup
  // would rewrite the label and the evidence together and the eval would report
  // a perfect score for agreeing with itself.
  const produced = chunk({ id: part, title: part, text: prepare(text) });

  const chunks = produced.map((c) => ({
    id: c.id,
    part: c.documentId,
    // Where this document ENDS, carried on every chunk so the server's prune knows
    // it without having to infer it from the request it happens to be looking at.
    //
    // Requests are packed to a fixed size out of a stream of chunks from many parts
    // and are sent concurrently, so a long datasheet is split across several of
    // them. A server that infers the end from one request infers a different, wrong
    // end from each, and deletes the chunks the other requests wrote. It did: a
    // third of the index, 8,414 chunks, gone at random. See `src/api/ingest.ts`.
    total: produced.length,
    // Every chunk names its part, deliberately.
    //
    // The part number used to reach every chunk by accident: it is stamped into the
    // legal footer of every page, so stripping the boilerplate stripped the only
    // thing anchoring a chunk to its own datasheet. Binding table rows to their
    // symbol then made the damage visible — `ID drain current VGS = 10 V; Tamb =
    // 25 °C` is now a complete, self-contained row, and it is also WORD FOR WORD the
    // same row in four hundred other datasheets. Retrieval promptly answered a
    // question about PMPB11EN with the ID rows of PMPB95ENEA, PMV65XP and PMN40ENE.
    //
    // So the anchor goes back in on purpose, as a header rather than as a copyright
    // notice. This is what the footer was doing all along; it was just doing it by
    // luck, and the luck ran out the moment the text got cleaner.
    text: `${part}\n${c.text}`,
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

/**
 * Post one batch, and survive a blip.
 *
 * Vectorize returned a single 502 four hundred requests into a run and the whole
 * ingest died, leaving the index half-written — which is worse than not having run
 * it, because the next thing to touch that index is an eval that will report a
 * number for a system that is in no coherent state. A transient upstream failure is
 * a fact of the platform, so it is the client's job to absorb it, not the operator's.
 */
async function post(payload: unknown, attempt = 0): Promise<number> {
  const response = await fetch(`${workerUrl}/ingest/chunks`, {
    method: "POST",
    // The token goes in a header, never in the URL: a URL lands in logs, in
    // shell history, and in referrers.
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });

  if (response.ok) return ((await response.json()) as { upserted: number }).upserted;

  const body = await response.text();
  if ((response.status >= 500 || response.status === 429) && attempt < 5) {
    await Bun.sleep(2 ** attempt * 1000 + Math.floor(Math.random() * 500));
    return post(payload, attempt + 1);
  }
  throw new Error(`ingest failed: HTTP ${response.status} ${body}`);
}

async function sendWorker(): Promise<void> {
  while (sendCursor < requests.length) {
    const payload = requests[sendCursor++];
    const upserted = await post(payload);
    sent += upserted;
    done++;
    if (done % 20 === 0) console.error(`${done}/${requests.length} requests · ${sent} chunks`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, sendWorker));

console.error(`\ndone: ${extracted.length} parts, ${sent} chunks${failed ? `, ${failed} unreadable` : ""}`);
