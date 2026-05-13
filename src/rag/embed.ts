import type { Env } from "../types";

export const EMBEDDING_DIMENSION = 1024;

export async function embedDocuments(env: Env, texts: string[]): Promise<number[][]> {
  return embed(env, texts, "search_document");
}

export async function embedQuery(env: Env, question: string): Promise<number[]> {
  const [embedding] = await embed(env, [question], "search_query");
  return embedding;
}

async function embed(env: Env, texts: string[], inputType: "search_document" | "search_query"): Promise<number[][]> {
  if (!env.COHERE_API_KEY) {
    throw new Error("Missing COHERE_API_KEY");
  }

  const response = await fetch("https://api.cohere.com/v2/embed", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.COHERE_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "embed-v4.0",
      texts,
      input_type: inputType,
      embedding_types: ["float"],
      output_dimension: EMBEDDING_DIMENSION
    })
  });

  if (!response.ok) {
    throw new Error(`Cohere embed failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { embeddings?: { float?: number[][] } };
  const embeddings = body.embeddings?.float;
  if (!embeddings || embeddings.length !== texts.length) {
    throw new Error("Cohere embed response did not contain the expected float embeddings");
  }
  return embeddings;
}
