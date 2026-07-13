import { describe, expect, test } from "bun:test";
import { chunk } from "../src/chunk";

const doc = (text: string) => ({ id: "PART-1", title: "PART-1", text });

/** Vectorize refuses metadata over 10 KB, and a chunk that large is useless anyway. */
const CEILING = 1800;

describe("chunk", () => {
  test("keeps every chunk under the ceiling, even from one unbroken block", () => {
    // A `pdftotext -layout` table page has no blank line in it, so the whole page
    // is a single block. Packing by blocks alone never splits it, and this corpus
    // produced a 13.8 KB chunk that way. That failure is what this test pins.
    const page = Array.from({ length: 60 }, (_, i) => `RDSon  drain-source on-state resistance  row ${i}`).join("\n");
    const chunks = chunk(doc(page));

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(CEILING);
  });

  test("cuts a single glued line that is longer than the ceiling", () => {
    // Not a line: a run of table cells that pdftotext never broke.
    const glued = "x".repeat(5000);
    for (const c of chunk(doc(glued))) expect(c.text.length).toBeLessThanOrEqual(CEILING);
  });

  test("leaves a short document as one chunk", () => {
    const chunks = chunk(doc("VDS  drain-source voltage  30 V\n\nRDSon  13.9 mOhm"));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe("PART-1#0");
    expect(chunks[0].documentId).toBe("PART-1");
  });

  test("overlaps the seam so a row split across two chunks survives in one", () => {
    const blocks = Array.from({ length: 8 }, (_, i) => `block ${i} ${"y".repeat(200)}`).join("\n\n");
    const chunks = chunk(doc(blocks));
    expect(chunks.length).toBeGreaterThan(1);
    // The tail of chunk n reappears at the head of chunk n+1.
    const tail = chunks[0].text.slice(-40);
    expect(chunks[1].text).toContain(tail);
  });
});
