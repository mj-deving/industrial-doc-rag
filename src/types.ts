/**
 * Plain configuration: strings out of `[vars]` and secrets.
 *
 * Kept separate from the bindings because most of the code only reads config, and
 * a function that reads config should not demand a live Vectorize handle in order
 * to be called. That is not test cosmetics: a signature that asks for more than it
 * uses is a signature that lies about what it does.
 */
export type Config = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;

  // v1: Qdrant. Still wired while the v2 index is built, deleted at the cutover.
  QDRANT_URL?: string;
  QDRANT_API_KEY?: string;
  QDRANT_COLLECTION?: string;
  QDRANT_INFERENCE_MODEL?: string;
};

export type Env = Config & {
  // v2: Cloudflare-native. Vectorize holds the chunks, Workers AI embeds them.
  // The PDFs are not stored at all: citations link to the vendor's own asset host.
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  /** Scaling-curve indices: the first 5 and the first 100 datasheets. */
  VECTORIZE_S: VectorizeIndex;
  VECTORIZE_M: VectorizeIndex;
  EMBEDDING_MODEL: string;
  /** Secret. Guards the write path; without it, /ingest is an open door onto the index. */
  INGEST_TOKEN?: string;
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
