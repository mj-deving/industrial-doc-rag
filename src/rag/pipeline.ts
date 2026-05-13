import { embedDocuments, embedQuery } from "./embed";
import { chunksFromPdfUrl } from "./pdf";
import { allLocalChunks, queryLocalCorpus } from "./local";
import { searchChunks, upsertChunks } from "./qdrant";
import { answerQuestion } from "./answer";
import type { Env, QueryResponse } from "../types";

export async function ingestPdf(env: Env, input: { pdfUrl: string; documentId?: string }) {
  if (!hasProviderConfig(env)) {
    const chunks = allLocalChunks().filter((chunk) => !input.documentId || chunk.documentId === input.documentId);
    return {
      documentId: input.documentId ?? "packaged-corpus",
      chunks: chunks.length,
      sourceUrl: input.pdfUrl,
      mode: "local-corpus" as const
    };
  }

  const chunks = await chunksFromPdfUrl(input.pdfUrl, input.documentId);
  const embeddings = await embedDocuments(env, chunks.map((chunk) => chunk.text));
  await upsertChunks(env, chunks, embeddings);
  return {
    documentId: chunks[0]?.documentId,
    chunks: chunks.length,
    sourceUrl: input.pdfUrl,
    mode: "provider-backed" as const
  };
}

export async function queryRag(env: Env, question: string): Promise<QueryResponse> {
  if (!question.trim()) {
    throw new Error("question must not be empty");
  }

  if (!hasProviderConfig(env)) {
    return queryLocalCorpus(question);
  }

  const queryVector = await embedQuery(env, question);
  const retrievals = await searchChunks(env, queryVector, 5);
  return answerQuestion(env, question, retrievals);
}

export function hasProviderConfig(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY && env.COHERE_API_KEY && env.QDRANT_URL && env.QDRANT_API_KEY);
}
