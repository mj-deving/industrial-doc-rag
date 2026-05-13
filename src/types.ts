export type Env = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  COHERE_API_KEY?: string;
  QDRANT_URL?: string;
  QDRANT_API_KEY?: string;
  QDRANT_COLLECTION?: string;
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
  mode?: "provider-backed" | "local-corpus";
};
