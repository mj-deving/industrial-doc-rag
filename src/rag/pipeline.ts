import { embedDocuments, embedQuery } from "./embed";
import { chunksFromPdfUrl } from "./pdf";
import { searchChunks, upsertChunks } from "./qdrant";
import { answerQuestion } from "./answer";
import type { Env, QueryResponse } from "../types";

export async function ingestPdf(env: Env, input: { pdfUrl: string; documentId?: string }) {
  const chunks = await chunksFromPdfUrl(input.pdfUrl, input.documentId);
  const embeddings = await embedDocuments(env, chunks.map((chunk) => chunk.text));
  await upsertChunks(env, chunks, embeddings);
  return {
    documentId: chunks[0]?.documentId,
    chunks: chunks.length,
    sourceUrl: input.pdfUrl
  };
}

export async function queryRag(env: Env, question: string): Promise<QueryResponse> {
  if (!question.trim()) {
    throw new Error("question must not be empty");
  }
  const queryVector = await embedQuery(env, question);
  const retrievals = await searchChunks(env, queryVector, 5);
  return answerQuestion(env, question, retrievals);
}
