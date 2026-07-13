/**
 * Retrieval metrics.
 *
 * Each question has exactly one relevant document: the datasheet the fact was
 * parsed out of. That single-gold setting has a consequence worth stating rather
 * than hiding, because it is the sort of thing a benchmark quietly exploits:
 *
 *   With one relevant document, nDCG@k is a strictly decreasing function of the
 *   gold document's rank, and so is MRR. They carry the SAME signal. Reporting
 *   both looks like two independent measurements and is not.
 *
 * We report both anyway, because they are the metrics the field expects, and we
 * say this out loud on the eval page. recall@k is the one that carries separate
 * information: it answers "did the answer even have a chance", which is the
 * question a generation failure and a retrieval failure disagree about.
 */

/** Rank of the gold document in a ranked list of document ids. 1-based. 0 = absent. */
export function rankOf(ranked: string[], gold: string): number {
  const index = ranked.indexOf(gold);
  return index === -1 ? 0 : index + 1;
}

export function recallAt(ranked: string[], gold: string, k: number): number {
  const rank = rankOf(ranked, gold);
  return rank > 0 && rank <= k ? 1 : 0;
}

/** Reciprocal rank. 0 when the gold document was never retrieved. */
export function reciprocalRank(ranked: string[], gold: string): number {
  const rank = rankOf(ranked, gold);
  return rank === 0 ? 0 : 1 / rank;
}

/**
 * nDCG@k with binary relevance and a single relevant document, so the ideal DCG
 * is 1 (gold at rank 1) and nDCG collapses to the discount at the gold's rank.
 */
export function ndcgAt(ranked: string[], gold: string, k: number): number {
  const rank = rankOf(ranked, gold);
  if (rank === 0 || rank > k) return 0;
  return 1 / Math.log2(rank + 1);
}

export type RetrievalMetrics = {
  questions: number;
  recall: Record<number, number>;
  mrr: number;
  ndcg: Record<number, number>;
};

export function retrievalMetrics(
  results: { ranked: string[]; gold: string }[],
  ks: number[] = [1, 3, 5, 10]
): RetrievalMetrics {
  const n = results.length || 1;
  const mean = (f: (r: { ranked: string[]; gold: string }) => number) =>
    Number((results.reduce((sum, r) => sum + f(r), 0) / n).toFixed(4));

  const recall: Record<number, number> = {};
  const ndcg: Record<number, number> = {};
  for (const k of ks) {
    recall[k] = mean((r) => recallAt(r.ranked, r.gold, k));
    ndcg[k] = mean((r) => ndcgAt(r.ranked, r.gold, k));
  }

  return { questions: results.length, recall, mrr: mean((r) => reciprocalRank(r.ranked, r.gold)), ndcg };
}

/**
 * Reciprocal Rank Fusion. Merges several ranked lists without needing their
 * scores to be comparable, which is the whole point: a dense cosine score and a
 * lookup hit live on different scales and normalising them is guesswork.
 *
 * k = 60 is the constant from Cormack et al. (2009); it damps the influence of
 * the top ranks just enough that one confident-but-wrong list cannot dominate.
 *
 * `weights` exists because plain RRF assumes every list is an OPINION about
 * relevance, and one of ours is not. An exact identifier match is a primary-key
 * lookup on the key the corpus itself is filed under, and giving it the same
 * vote as a cosine neighbour discards that. Unweighted, a symbol hit at rank 1
 * and a dense hit at rank 1 score identically and the tie breaks arbitrarily,
 * which is how a fusion silently degrades into its weaker arm.
 *
 * The weight is a judgment, not a tuned number, so it is passed in by the caller
 * and both the weighted and the unweighted arm are reported side by side. The
 * eval is where a judgment goes to be checked.
 */
export function rrf(lists: string[][], k = 60, weights?: number[]): string[] {
  const scores = new Map<string, number>();
  lists.forEach((list, listIndex) => {
    const weight = weights?.[listIndex] ?? 1;
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + index + 1));
    });
  });
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
