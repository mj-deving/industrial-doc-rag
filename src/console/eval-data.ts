// The shape of the committed results files the /eval page renders.
//
// Declared here rather than inferred from the JSON so that a change to the eval's
// output shape breaks the build instead of quietly rendering `undefined` into a
// number on a public page.

export type Metrics = {
  questions: number;
  recall: Record<number, number>;
  mrr: number;
  ndcg: Record<number, number>;
};

export type Results = {
  generatedAt: string;
  corpus: { documents: number; heldOut: number; questions: number };
  retrieval: Record<string, Metrics>;
  best: string;
  answer: {
    sample: number;
    correct: number;
    wrongValue: number;
    noValue: number;
    refusedWrongly: number;
    byDimension: Record<string, { n: number; correct: number }>;
  };
  refusal: {
    sample: number;
    /** What the MODEL does alone. The eval runs with the identifier guard off. */
    refused: number;
    hallucinated: number;
    hallucinatedButCorrect: number;
    /** What the SHIPPED system does. Derived from the parts each question retrieved,
     *  not measured, because a held-out datasheet cannot be retrieved and so the
     *  guard always fires: a measured 1.0 would restate the guard's definition. */
    guarded: {
      refused: number;
      /** The guard's cost: indexed parts it would refuse. Zero, and asserted rather
       *  than assumed, because the day retrieval regresses is the day it starts
       *  eating real answers. */
      wronglyRefusedIndexed: number;
    };
  };
  latency: Record<string, number>;
};

export type Scale = {
  generatedAt: string;
  strategies: readonly string[];
  curve: {
    documents: number;
    chunks: number;
    questions: number;
    storedDimensions: number;
    storageUsdPerMonth: number;
    /** The arm that feels the corpus. This is the column that moves. */
    denseRecallAt1: number;
    denseRecallAt5: number;
    denseMrr: number;
    /** The arm that does not: a key lookup is indifferent to how many neighbours it has. */
    fusedRecallAt1: number;
    p50Ms: number;
    p95Ms: number;
  }[];
};

/**
 * The identifier-free arm: questions about the SET rather than about a document.
 *
 * "Which 40 V part has the lowest RDS(on)?" names no datasheet, so there is no key to
 * look up, and the answer is a property of all 497 documents rather than of any one of
 * them. Ten retrieved chunks are ten documents. Two systems are measured on the SAME 248
 * questions: the shipped RAG pipeline (`CorpusBaseline`) and the catalogue the ingest
 * builds (`CorpusEval`).
 */
export type CorpusEval = {
  generatedAt: string;
  questions: number;
  routes: { catalog: number; retrieval: number };
  outcomes: {
    correct: number;
    wrong: number;
    hedged: number;
    guardRefused: number;
    modelRefused: number;
    catalogEmpty: number;
  };
  accuracy: number;
  precisionWhenAnswered: number;
  byKind: Record<string, { n: number; correct: number; wrong: number }>;
  /** Of the wrong superlatives, the share whose winner was never in the pool the query
   *  competed. The arithmetic is a for loop and is exact by construction, so this is the
   *  share of remaining error that belongs to the READING rather than to the query. */
  wrongWinnerNotInPool: number;
};

export type CorpusBaseline = {
  generatedAt: string;
  questions: number;
  outcomes: { correct: number; wrong: number; guardRefused: number; modelRefused: number };
  accuracy: number;
  precisionWhenAnswered: number;
  /** How often the winning datasheet reached the model at all. The whole argument. */
  winnerRetrieved: number;
  /** And of the ones it got wrong, how often it never saw the winner. */
  wrongWithoutSeeingWinner: number;
};
