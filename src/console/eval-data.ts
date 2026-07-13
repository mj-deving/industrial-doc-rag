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
    refused: number;
    hallucinated: number;
    hallucinatedButCorrect: number;
  };
  latency: Record<string, number>;
};

export type Scale = {
  generatedAt: string;
  strategy: string;
  curve: {
    documents: number;
    chunks: number;
    questions: number;
    storedDimensions: number;
    storageUsdPerMonth: number;
    recallAt1: number;
    recallAt5: number;
    mrr: number;
    p50Ms: number;
    p95Ms: number;
  }[];
};
