import { describe, expect, test } from "bun:test";
import { ndcgAt, recallAt, reciprocalRank, retrievalMetrics, rrf } from "../src/metrics";

const ranked = ["A", "B", "C", "D"];

describe("retrieval metrics", () => {
  test("recall@k is a hit inside the cutoff and a miss outside it", () => {
    expect(recallAt(ranked, "C", 3)).toBe(1);
    expect(recallAt(ranked, "D", 3)).toBe(0);
    expect(recallAt(ranked, "Z", 10)).toBe(0);
  });

  test("reciprocal rank is zero when the gold document never surfaces", () => {
    expect(reciprocalRank(ranked, "A")).toBe(1);
    expect(reciprocalRank(ranked, "C")).toBeCloseTo(1 / 3);
    expect(reciprocalRank(ranked, "Z")).toBe(0);
  });

  test("nDCG is 1 at rank 1 and decays with the rank", () => {
    expect(ndcgAt(ranked, "A", 10)).toBe(1);
    expect(ndcgAt(ranked, "B", 10)).toBeCloseTo(1 / Math.log2(3));
    expect(ndcgAt(ranked, "D", 3)).toBe(0);
  });

  test("aggregates over a question set", () => {
    const metrics = retrievalMetrics(
      [
        { ranked: ["A", "B"], gold: "A" },
        { ranked: ["A", "B"], gold: "B" },
        { ranked: ["A", "B"], gold: "Z" }
      ],
      [1, 3]
    );
    expect(metrics.questions).toBe(3);
    expect(metrics.recall[1]).toBeCloseTo(1 / 3);
    expect(metrics.recall[3]).toBeCloseTo(2 / 3);
    expect(metrics.mrr).toBeCloseTo((1 + 0.5 + 0) / 3);
  });
});

describe("rrf", () => {
  test("a document ranked well by both lists beats one ranked well by either", () => {
    // Dense likes X then Y; keyword likes Y then X. Y is second on one list and
    // first on the other, X is the reverse, so they tie; Z, which only one list
    // saw at all, must come last.
    const fused = rrf([["X", "Y", "Z"], ["Y", "X"]]);
    expect(fused.slice(0, 2).sort()).toEqual(["X", "Y"]);
    expect(fused.at(-1)).toBe("Z");
  });

  test("agreement at the top wins over a single strong vote", () => {
    const fused = rrf([["A", "B"], ["B", "A"], ["B", "A"]]);
    expect(fused[0]).toBe("B");
  });
});
