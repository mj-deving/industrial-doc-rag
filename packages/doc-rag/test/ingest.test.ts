import { describe, expect, test } from "bun:test";
import { staleIds, type IngestChunk } from "../../../src/api/contracts";

/**
 * The prune deleted a third of the index — 8,414 of 25,536 chunks — and the eval
 * still scored 0.95, so nothing failed loudly enough to notice. These are the
 * assertions that would have.
 */

const chunksFor = (part: string, from: number, to: number, total: number): IngestChunk[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    id: `${part}#${from + i}`,
    part,
    text: "row",
    index: from + i,
    total
  }));

describe("prune range", () => {
  // THE bug. A 50-chunk datasheet is split across two concurrent requests because
  // requests are packed to a fixed size out of a stream of many parts' chunks. The
  // request holding chunks 0..6 used to conclude the document ended at 6 and delete
  // #7..#86 — the chunks the other request had just written. Which one won depended
  // on which HTTP response landed first.
  test("two halves of one document prune the same range", () => {
    const head = staleIds(chunksFor("PMV45EN2", 0, 6, 50));
    const tail = staleIds(chunksFor("PMV45EN2", 7, 49, 50));
    expect(head).toEqual(tail);
  });

  test("a request never deletes a chunk it or its siblings wrote", () => {
    const total = 50;
    const doomed = new Set(staleIds(chunksFor("PMV45EN2", 0, 6, total)));
    for (let index = 0; index < total; index++) {
      expect(doomed.has(`PMV45EN2#${index}`)).toBe(false);
    }
  });

  test("the sweep starts at the document's end and reaches past it", () => {
    const ids = staleIds(chunksFor("PART", 0, 9, 10));
    expect(ids[0]).toBe("PART#10");
    expect(ids).toContain("PART#60");
    expect(ids).not.toContain("PART#9");
  });

  test("each part in a mixed request is swept at its own end", () => {
    const ids = staleIds([...chunksFor("A", 0, 2, 3), ...chunksFor("B", 0, 0, 40)]);
    expect(ids).toContain("A#3");
    expect(ids).toContain("B#40");
    expect(ids).not.toContain("B#39"); // B has 40 chunks; #39 is its last, and live.
  });
});
