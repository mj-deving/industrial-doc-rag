import { describe, expect, it } from "bun:test";
import { chunkText } from "../src/rag/chunk";
import { confidenceFromRetrievals } from "../src/rag/answer";
import { uuidFromString } from "../src/rag/qdrant";

describe("chunking", () => {
  it("creates stable datasheet chunks with metadata", () => {
    const chunks = chunkText({
      documentId: "sample",
      title: "Sample",
      partNumber: "DEMO",
      sourceUrl: "https://example.com/sample.pdf",
      text: "A ".repeat(700) + "\n\n" + "B ".repeat(700)
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].id).toBe("sample-0");
    expect(chunks[0].partNumber).toBe("DEMO");
  });
});

describe("qdrant ids", () => {
  it("turns stable chunk ids into qdrant-compatible UUIDs", () => {
    expect(uuidFromString("ipb017n10n5-0")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidFromString("ipb017n10n5-0")).toBe(uuidFromString("ipb017n10n5-0"));
  });
});

describe("confidence", () => {
  it("uses score strength and spread", () => {
    expect(confidenceFromRetrievals([{ score: 0.82 }, { score: 0.7 }] as never)).toBe("high");
    expect(confidenceFromRetrievals([{ score: 0.7 }, { score: 0.69 }] as never)).toBe("medium");
    expect(confidenceFromRetrievals([{ score: 0.5 }] as never)).toBe("low");
  });
});
