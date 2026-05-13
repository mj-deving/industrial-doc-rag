import { EMBEDDING_DIMENSION } from "./embed";
import type { DatasheetChunk, Env, Retrieval } from "../types";

type QdrantPoint = {
  id: string;
  vector: number[];
  payload: DatasheetChunk;
};

export async function ensureCollection(env: Env): Promise<void> {
  const collection = getCollection(env);
  const existing = await qdrant(env, `/collections/${collection}`, { method: "GET" });
  if (existing.status === 200) {
    return;
  }
  if (existing.status !== 404) {
    throw new Error(`Qdrant collection check failed: ${existing.status} ${await existing.text()}`);
  }

  const created = await qdrant(env, `/collections/${collection}`, {
    method: "PUT",
    body: JSON.stringify({
      vectors: {
        size: EMBEDDING_DIMENSION,
        distance: "Cosine"
      }
    })
  });
  if (!created.ok) {
    throw new Error(`Qdrant collection create failed: ${created.status} ${await created.text()}`);
  }
}

export async function upsertChunks(env: Env, chunks: DatasheetChunk[], embeddings: number[][]): Promise<void> {
  if (chunks.length !== embeddings.length) {
    throw new Error("Chunk and embedding count mismatch");
  }

  await ensureCollection(env);
  const points: QdrantPoint[] = chunks.map((chunk, index) => ({
    id: chunk.id,
    vector: embeddings[index],
    payload: chunk
  }));

  const response = await qdrant(env, `/collections/${getCollection(env)}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({ points })
  });
  if (!response.ok) {
    throw new Error(`Qdrant upsert failed: ${response.status} ${await response.text()}`);
  }
}

export async function searchChunks(env: Env, vector: number[], limit = 5): Promise<Retrieval[]> {
  const response = await qdrant(env, `/collections/${getCollection(env)}/points/search`, {
    method: "POST",
    body: JSON.stringify({
      vector,
      limit,
      with_payload: true
    })
  });
  if (!response.ok) {
    throw new Error(`Qdrant search failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { result?: Array<{ score: number; payload: DatasheetChunk }> };
  return (body.result ?? []).map((hit) => ({
    ...hit.payload,
    score: hit.score
  }));
}

function getCollection(env: Env): string {
  return env.QDRANT_COLLECTION ?? "industrial_datasheets";
}

function qdrant(env: Env, path: string, init: RequestInit): Promise<Response> {
  if (!env.QDRANT_URL) {
    throw new Error("Missing QDRANT_URL");
  }
  if (!env.QDRANT_API_KEY) {
    throw new Error("Missing QDRANT_API_KEY");
  }
  const baseUrl = env.QDRANT_URL.replace(/\/$/, "");
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "api-key": env.QDRANT_API_KEY,
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });
}
