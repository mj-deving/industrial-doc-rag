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
