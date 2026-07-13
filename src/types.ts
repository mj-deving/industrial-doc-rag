/**
 * The Worker's bindings.
 *
 * v1 also kept a `Config` type here, for Qdrant credentials and an Anthropic key.
 * Both are gone at the cutover: the pipeline is Cloudflare-native now, and a config
 * type with no fields left in it is a type that exists to be deleted.
 */
export type Env = {
  /** Workers AI: bge-m3 for embeddings, llama-3.3-70b for generation. */
  AI: Ai;
  /** The corpus. One metadata-filterable `part` per vector, which is what makes an
   *  unindexed part return nothing and refusal a property of retrieval. */
  VECTORIZE: VectorizeIndex;
  /** Scaling-curve indices: the first 5 and the first 100 datasheets. */
  VECTORIZE_S: VectorizeIndex;
  VECTORIZE_M: VectorizeIndex;
  EMBEDDING_MODEL: string;
  /** Secret. Guards the write path and the eval harness; without it, both are shut. */
  INGEST_TOKEN?: string;
};
