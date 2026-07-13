import { describe, expect, test } from "bun:test";
import { retrieve, type Index, type Retriever } from "../src/retrieve";
import type { Retrieved } from "../src/types";

const hit = (documentId: string, score: number, index = 0): Retrieved => ({
  chunk: { id: `${documentId}-${index}`, documentId, text: `text of ${documentId}`, index },
  score
});

/**
 * A dense index that is confidently wrong in the way this corpus is hard: it
 * ranks two lookalike datasheets above the one the question actually names, and
 * for GOLD it does not return the right document at all.
 *
 * `searchWithin` returns SEVERAL chunks of a document, because a real datasheet
 * is seventy-odd of them and the value the question asks for sits in exactly one.
 * The first version of this fake returned a single chunk per document, so it
 * could not express the bug that document-level fusion introduced, and the suite
 * passed while the deployed system answered 36% of its questions. A fixture
 * simpler than the corpus proves nothing about the corpus.
 */
function fakeIndex(indexed: string[], dense: Retrieved[], chunksPerDocument = 3): Index {
  return {
    async search(_vector, k) {
      return dense.slice(0, k);
    },
    async searchWithin(_vector, k, documentId) {
      if (!indexed.includes(documentId)) return [];
      return Array.from({ length: Math.min(k, chunksPerDocument) }, (_, i) =>
        hit(documentId, 0.99 - i / 100, i)
      );
    }
  };
}

function retriever(index: Index): Retriever {
  return {
    index,
    async embed() {
      return [0, 0, 0];
    },
    symbolsOf: (query) => [...query.matchAll(/\bPSMN[A-Z0-9-]+\b/g)].map((m) => m[0])
  };
}

const QUESTION = "What is the RDS(on) of the PSMN1R0-30YLD?";

describe("retrieve", () => {
  test("dense passes the vector ranking through untouched", async () => {
    const dense = [hit("PSMN2R1-30YLE", 0.9), hit("PSMN1R0-30YLD", 0.8)];
    const ranking = await retrieve(retriever(fakeIndex([], dense)), QUESTION, "dense");
    expect(ranking.documents).toEqual(["PSMN2R1-30YLE", "PSMN1R0-30YLD"]);
  });

  test("dense+symbol floats the named document over its lookalikes", async () => {
    const dense = [hit("PSMN2R1-30YLE", 0.9), hit("PSMN3R0-30YLD", 0.85), hit("PSMN1R0-30YLD", 0.8)];
    const ranking = await retrieve(retriever(fakeIndex([], dense)), QUESTION, "dense+symbol");
    expect(ranking.documents[0]).toBe("PSMN1R0-30YLD");
    expect(ranking.symbols).toEqual(["PSMN1R0-30YLD"]);
    // The rest keep their dense order. This is a partition, not a re-scoring.
    expect(ranking.documents.slice(1)).toEqual(["PSMN2R1-30YLE", "PSMN3R0-30YLD"]);
  });

  test("dense+symbol cannot rescue a document dense never returned", async () => {
    // The premise of the whole ablation. A rerank only reorders what it was
    // handed, so when dense misses the datasheet outright, the rerank misses too.
    const dense = [hit("PSMN2R1-30YLE", 0.9), hit("PSMN3R0-30YLD", 0.85)];
    const ranking = await retrieve(
      retriever(fakeIndex(["PSMN1R0-30YLD"], dense)),
      QUESTION,
      "dense+symbol"
    );
    expect(ranking.documents).not.toContain("PSMN1R0-30YLD");
  });

  test("hybrid-rrf does rescue it, because the symbol arm queries it directly", async () => {
    const dense = [hit("PSMN2R1-30YLE", 0.9), hit("PSMN3R0-30YLD", 0.85)];
    const ranking = await retrieve(
      retriever(fakeIndex(["PSMN1R0-30YLD"], dense)),
      QUESTION,
      "hybrid-rrf"
    );
    expect(ranking.documents[0]).toBe("PSMN1R0-30YLD");
    expect(ranking.chunks[0].chunk.documentId).toBe("PSMN1R0-30YLD");
  });

  test("hybrid-rrf hands the generator several pages of the named datasheet", async () => {
    // The regression. Ranking documents and assembling evidence are different
    // jobs: one chunk per document is a correct DOCUMENT ranking and a useless
    // EXCERPT set, because the one chunk it keeps is whichever page embedded
    // closest to the question, not the page the answer is printed on.
    const dense = [hit("PSMN2R1-30YLE", 0.9), hit("PSMN3R0-30YLD", 0.85)];
    const ranking = await retrieve(
      retriever(fakeIndex(["PSMN1R0-30YLD"], dense)),
      QUESTION,
      "hybrid-rrf"
    );
    const fromNamed = ranking.chunks.filter((c) => c.chunk.documentId === "PSMN1R0-30YLD");
    expect(fromNamed.length).toBe(3);
    expect(new Set(fromNamed.map((c) => c.chunk.id)).size).toBe(3);
  });

  test("a held-out document stays unreachable to every arm", async () => {
    // PSMN1R0-30YLD is named in the question and is NOT in the index. The symbol
    // arm returns nothing for it, so refusal is a property of retrieval and not a
    // thing we ask the model to promise in a prompt.
    const dense = [hit("PSMN2R1-30YLE", 0.9)];
    const ranking = await retrieve(retriever(fakeIndex([], dense)), QUESTION, "hybrid-rrf");
    expect(ranking.documents).not.toContain("PSMN1R0-30YLD");
    expect(ranking.symbols).toEqual(["PSMN1R0-30YLD"]);
  });
});
