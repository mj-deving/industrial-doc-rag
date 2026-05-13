import { describe, expect, it } from "bun:test";
import { corpus, findCorpusByUrl } from "../src/corpus/manifest";
import { chunksFromCorpusFacts } from "../src/rag/chunk";

describe("corpus", () => {
  it("contains five Infineon MOSFET datasheets", () => {
    expect(corpus).toHaveLength(5);
    expect(corpus.every((doc) => doc.pdfUrl.includes("infineon.com"))).toBe(true);
  });

  it("can resolve URL variants", () => {
    const doc = corpus[0];
    expect(findCorpusByUrl(doc.pdfUrl.split("?")[0])?.documentId).toBe(doc.documentId);
  });

  it("turns curated facts into retrievable chunks", () => {
    const chunks = chunksFromCorpusFacts(corpus[0]);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].text).toContain(corpus[0].partNumber);
  });
});
