import type { DatasheetChunk, Config, Retrieval } from "../types";

const DEFAULT_INFERENCE_MODEL = "sentence-transformers/all-minilm-l6-v2";
const DEFAULT_INFERENCE_DIMENSION = 384;

type QdrantPoint = {
  id: string;
  vector: number[] | QdrantInferenceDocument;
  payload: DatasheetChunk;
};

type QdrantInferenceDocument = {
  text: string;
  model: string;
};

export async function ensureCollection(env: Config): Promise<void> {
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
        size: DEFAULT_INFERENCE_DIMENSION,
        distance: "Cosine"
      }
    })
  });
  if (created.status === 409) {
    return;
  }
  if (!created.ok) {
    throw new Error(`Qdrant collection create failed: ${created.status} ${await created.text()}`);
  }
}

export async function upsertChunks(env: Config, chunks: DatasheetChunk[], embeddings?: number[][]): Promise<void> {
  if (!embeddings) {
    return upsertChunksWithInference(env, chunks);
  }

  if (chunks.length !== embeddings.length) {
    throw new Error("Chunk and embedding count mismatch");
  }

  await ensureCollection(env);
  const points: QdrantPoint[] = chunks.map((chunk, index) => ({
    id: uuidFromString(chunk.id),
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

export async function upsertChunksWithInference(env: Config, chunks: DatasheetChunk[]): Promise<void> {
  await ensureCollection(env);
  const model = getInferenceModel(env);
  const points: QdrantPoint[] = chunks.map((chunk) => ({
    id: uuidFromString(chunk.id),
    vector: {
      text: chunk.text,
      model
    },
    payload: chunk
  }));

  const response = await qdrant(env, `/collections/${getCollection(env)}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({ points })
  });
  if (!response.ok) {
    throw new Error(`Qdrant inference upsert failed: ${response.status} ${await response.text()}`);
  }
}

export function uuidFromString(value: string): string {
  const bytes = new Uint8Array(16);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
    bytes[i % 16] ^= hash & 0xff;
    bytes[(i * 7) % 16] ^= (hash >>> 8) & 0xff;
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function searchChunks(env: Config, vector: number[], limit = 5): Promise<Retrieval[]> {
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

export async function searchChunksWithInference(env: Config, question: string, limit = 5): Promise<Retrieval[]> {
  const response = await qdrant(env, `/collections/${getCollection(env)}/points/query`, {
    method: "POST",
    body: JSON.stringify({
      query: {
        text: question,
        model: getInferenceModel(env)
      },
      limit,
      with_payload: true
    })
  });
  if (!response.ok) {
    throw new Error(`Qdrant inference query failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    result?: Array<{ score: number; payload: DatasheetChunk }> | { points?: Array<{ score: number; payload: DatasheetChunk }> };
  };
  const result = Array.isArray(body.result) ? body.result : body.result?.points ?? [];
  return result.map((hit) => ({
    ...hit.payload,
    score: hit.score
  }));
}

export function hasQdrantConfig(env: Config): boolean {
  return Boolean(env.QDRANT_URL && env.QDRANT_API_KEY);
}

function getCollection(env: Config): string {
  return env.QDRANT_COLLECTION ?? "industrial_datasheets";
}

function getInferenceModel(env: Config): string {
  return env.QDRANT_INFERENCE_MODEL ?? DEFAULT_INFERENCE_MODEL;
}

export function qdrant(env: Config, path: string, init: RequestInit): Promise<Response> {
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
