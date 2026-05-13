export type Env = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  QDRANT_URL?: string;
  QDRANT_API_KEY?: string;
  QDRANT_COLLECTION?: string;
  QDRANT_INFERENCE_MODEL?: string;
};

export type DatasheetChunk = {
  id: string;
  documentId: string;
  title: string;
  sourceUrl: string;
  partNumber: string;
  text: string;
  chunkIndex: number;
};

export type Retrieval = DatasheetChunk & {
  score: number;
};

export type QueryResponse = {
  answer: string;
  sources: Array<{
    title: string;
    sourceUrl: string;
    partNumber: string;
    score: number;
    excerpt: string;
  }>;
  confidence: "low" | "medium" | "high";
  retrievals: Retrieval[];
  mode?: "qdrant-inference" | "anthropic-qdrant" | "local-corpus";
};
