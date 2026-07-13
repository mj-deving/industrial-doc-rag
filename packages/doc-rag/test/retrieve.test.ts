import { describe, expect, test } from "bun:test";
import { retrieve, type Index, type Retriever } from "../src/retrieve";
import type { Retrieved } from "../src/types";

const hit = (documentId: string, score: number): Retrieved => ({
  chunk: { id: `${documentId}-0`, documentId, text: `text of ${documentId}`, index: 0 },
  score
});

/**
 * A dense index that is confidently wrong in the way this corpus is hard: it
 * ranks two lookalike datasheets above the one the question actually names, and
 * for GOLD it does not return the right document at all.
 */
function fakeIndex(indexed: string[], dense: Retrieved[]): Index {
  return {
    async search(_vector, k) {
      return dense.slice(0, k);
    },
    async searchWithin(_vector, _k, documentId) {
      return indexed.includes(documentId) ? [hit(documentId, 0.99)] : [];
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
