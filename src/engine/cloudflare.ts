/**
 * The engine, bound to Cloudflare.
 *
 * Workers AI supplies the embeddings, Vectorize supplies the index. Nothing in
 * `packages/doc-rag` imports this file; everything here implements interfaces it
 * declares. That direction is the point — swap this module and the same eval
 * runs against a different substrate without touching a metric.
 */

import type { Index } from "../../packages/doc-rag/src/retrieve";
import type { Retrieved } from "../../packages/doc-rag/src/types";
import { partNumbersIn } from "./symbols";
import type { Env } from "../types";

/** What we store alongside each vector. `part` is the filterable key. */
export type VectorMeta = {
  part: string;
  text: string;
  index: number;
};

/**
 * The model id is a `[vars]` string, so its type is `string` and not one of the
 * literals `AI.run` overloads on. The binding's declared return for an unknown id
 * is a ReadableStream, which is why this goes through `unknown`: the cast is
 * asserting a fact about bge-m3's response shape that the types cannot see.
 */
type EmbeddingResponse = { data: number[][] };

export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const response = (await env.AI.run(env.EMBEDDING_MODEL as keyof AiModels, {
    text: texts
  } as never)) as unknown as EmbeddingResponse;

  if (!Array.isArray(response?.data) || response.data.length !== texts.length) {
    throw new Error(`embedding model returned ${response?.data?.length ?? 0} vectors for ${texts.length} texts`);
  }
  return response.data;
}

function toRetrieved(matches: VectorizeMatches["matches"]): Retrieved[] {
  return matches
    .filter((match) => match.metadata)
    .map((match) => {
      const meta = match.metadata as unknown as VectorMeta;
      return {
        chunk: { id: match.id, documentId: meta.part, text: meta.text, index: meta.index },
        score: match.score
      };
    });
}

export function vectorizeIndex(env: Env): Index {
  return {
    async search(vector, k) {
      const result = await env.VECTORIZE.query(vector, { topK: k, returnMetadata: "all" });
      return toRetrieved(result.matches);
    },

    async searchWithin(vector, k, documentId) {
      // A metadata filter, not a local part list. The symbol arm therefore cannot
      // drift out of step with what was actually ingested: ask for a held-out
      // part and Vectorize returns nothing, which is precisely the right answer.
      const result = await env.VECTORIZE.query(vector, {
        topK: k,
        returnMetadata: "all",
        filter: { part: documentId }
      });
      return toRetrieved(result.matches);
    }
  };
}

export function retriever(env: Env) {
  return {
    index: vectorizeIndex(env),
    embed: async (text: string) => (await embed(env, [text]))[0],
    symbolsOf: partNumbersIn
  };
}
