/**
 * The three retrieval strategies the ablation compares.
 *
 * The interesting question in a technical corpus is not "does BM25 beat dense".
 * It is how the work divides between SEMANTICS and SYMBOLS. Every document in a
 * corpus like this one has an identifier, that identifier is what the user types,
 * and a vector model treats it as a nearly meaningless token: 700 datasheets for
 * 700 near-identical MOSFETs embed into almost the same place, and the one thing
 * that actually separates them is the string the embedding is worst at.
 *
 * So:
 *
 *   dense         Vector search alone. The baseline, and the thing most RAG demos
 *                 ship without ever measuring.
 *
 *   dense+symbol  Vector search, then float any chunk whose document was NAMED in
 *                 the question to the top. It can only reorder what dense already
 *                 found. If dense missed the document entirely, this cannot save it.
 *
 *   hybrid-rrf    Vector search FUSED with a symbol lookup that runs independently.
 *                 The symbol arm can surface a document dense never returned.
 *
 * The gap between the last two is the whole point: it measures how often dense
 * retrieval does not merely misrank the right datasheet but fails to retrieve it
 * at all. A rerank cannot fix that and a fusion can, and no amount of arguing
 * settles which is happening. Only the number does.
 */

import { rrf } from "./metrics";
import type { Retrieved } from "./types";

export const STRATEGIES = ["dense", "dense+symbol", "hybrid-rrf"] as const;
export type Strategy = (typeof STRATEGIES)[number];

/**
 * How much a symbol hit outweighs a dense hit in the fusion.
 *
 * Unweighted, RRF scores a symbol hit at rank 1 and a dense hit at rank 1
 * identically, the tie breaks arbitrarily, and the fusion quietly degrades into
 * its weaker arm. That is not a tie worth having: one of the two is a
 * primary-key lookup on the document the user named, and the other is a cosine
 * neighbour in a space where 700 MOSFET datasheets sit almost on top of one
 * another.
 *
 * 2 is a judgment. It is stated here rather than buried, and the eval reports the
 * unfused arms next to the fused one, so the judgment is checkable instead of
 * merely asserted.
 */
export const SYMBOL_WEIGHT = 2;

export type Index = {
  /** Dense search across the whole corpus. */
  search(vector: number[], k: number): Promise<Retrieved[]>;
  /**
   * Dense search restricted to one document.
   *
   * Returns [] when the document is not in the index, which is exactly what a
   * held-out part must do: the symbol arm cannot conjure a document that was
   * never ingested, so refusal falls out of the retrieval layer instead of being
   * bolted onto the prompt.
   */
  searchWithin(vector: number[], k: number, documentId: string): Promise<Retrieved[]>;
};

export type Retriever = {
  index: Index;
  embed(text: string): Promise<number[]>;
  /**
   * Pull document-identifier-shaped tokens out of a query.
   *
   * This is the only thing the engine needs to know about a corpus's naming
   * scheme, and it is deliberately the corpus's job to supply it. A datasheet
   * adapter looks for part numbers; a legal adapter would look for case numbers.
   */
  symbolsOf(query: string): string[];
};

export type Ranking = {
  /** Ranked document ids, best first, deduplicated. What the metrics score. */
  documents: string[];
  /** The chunks behind that ranking, best first. What the generator reads. */
  chunks: Retrieved[];
  /** Identifiers found in the query. Empty when the user asked a question that
   *  names no document, which is a different retrieval problem and worth seeing. */
  symbols: string[];
};

/** Collapse a chunk ranking to a document ranking, keeping each document's best chunk. */
function toDocuments(chunks: Retrieved[]): string[] {
  const seen = new Set<string>();
  const documents: string[] = [];
  for (const { chunk } of chunks) {
    if (seen.has(chunk.documentId)) continue;
    seen.add(chunk.documentId);
    documents.push(chunk.documentId);
  }
  return documents;
}

export async function retrieve(
  retriever: Retriever,
  question: string,
  strategy: Strategy,
  k = 10
): Promise<Ranking> {
  const vector = await retriever.embed(question);
  const symbols = retriever.symbolsOf(question);
  const dense = await retriever.index.search(vector, k);

  if (strategy === "dense") {
    return { documents: toDocuments(dense), chunks: dense, symbols };
  }

  if (strategy === "dense+symbol") {
    const named = new Set(symbols);
    // A stable partition, not a sort: chunks keep their dense order within each
    // group, so this measures the rerank and nothing else.
    const promoted = dense.filter((r) => named.has(r.chunk.documentId));
    const rest = dense.filter((r) => !named.has(r.chunk.documentId));
    const chunks = [...promoted, ...rest];
    return { documents: toDocuments(chunks), chunks, symbols };
  }

  // hybrid-rrf: the symbol arm queries each named document directly, so it can
  // return a document that never appeared in the dense list at all.
  const symbolHits = (
    await Promise.all(symbols.map((symbol) => retriever.index.searchWithin(vector, k, symbol)))
  ).flat();

  const fused = rrf([toDocuments(dense), toDocuments(symbolHits)], 60, [1, SYMBOL_WEIGHT]);

  const byDocument = new Map<string, Retrieved>();
  for (const hit of [...symbolHits, ...dense]) {
    const existing = byDocument.get(hit.chunk.documentId);
    if (!existing || hit.score > existing.score) byDocument.set(hit.chunk.documentId, hit);
  }

  return {
    documents: fused,
    chunks: fused.map((id) => byDocument.get(id)!).filter(Boolean),
    symbols
  };
}
