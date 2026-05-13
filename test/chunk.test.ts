import { describe, expect, it } from "bun:test";
import { chunkText } from "../src/rag/chunk";
import { confidenceFromRetrievals } from "../src/rag/answer";

describe("chunking", () => {
  it("creates stable datasheet chunks with metadata", () => {
    const chunks = chunkText({
      documentId: "demo",
      title: "Demo",
      partNumber: "DEMO",
      sourceUrl: "https://example.com/demo.pdf",
      text: "A ".repeat(700) + "\n\n" + "B ".repeat(700)
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].id).toBe("demo-0");
    expect(chunks[0].partNumber).toBe("DEMO");
  });
});

describe("confidence", () => {
  it("uses score strength and spread", () => {
    expect(confidenceFromRetrievals([{ score: 0.82 }, { score: 0.7 }] as never)).toBe("high");
    expect(confidenceFromRetrievals([{ score: 0.7 }, { score: 0.69 }] as never)).toBe("medium");
    expect(confidenceFromRetrievals([{ score: 0.5 }] as never)).toBe("low");
  });
});
