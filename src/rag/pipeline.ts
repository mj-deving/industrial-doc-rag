import { chunksFromPdfUrl } from "./pdf";
import { allLocalChunks, queryLocalCorpus, rerankForDatasheetIdentifiers, responseFromRetrievals } from "./local";
import { hasQdrantConfig, searchChunksWithInference, upsertChunksWithInference } from "./qdrant";
import { answerQuestion } from "./answer";
import type { Env, QueryResponse } from "../types";

export async function ingestPdf(env: Env, input: { pdfUrl: string; documentId?: string }) {
  if (!hasQdrantConfig(env)) {
    const chunks = allLocalChunks().filter((chunk) => !input.documentId || chunk.documentId === input.documentId);
    return {
      documentId: input.documentId ?? "packaged-corpus",
      chunks: chunks.length,
      sourceUrl: input.pdfUrl,
      mode: "local-corpus" as const
    };
  }

  const chunks = await chunksFromPdfUrl(input.pdfUrl, input.documentId);
  await upsertChunksWithInference(env, chunks);
  return {
    documentId: chunks[0]?.documentId,
    chunks: chunks.length,
    sourceUrl: input.pdfUrl,
    mode: "qdrant-inference" as const
  };
}

export async function ingestPackagedCorpus(env: Env) {
  const chunks = allLocalChunks();
  if (!hasQdrantConfig(env)) {
    return {
      documentId: "packaged-corpus",
      chunks: chunks.length,
      mode: "local-corpus" as const
    };
  }

  await upsertChunksWithInference(env, chunks);
  return {
    documentId: "packaged-corpus",
    chunks: chunks.length,
    mode: "qdrant-inference" as const
  };
}

export async function queryRag(env: Env, question: string): Promise<QueryResponse> {
  if (!question.trim()) {
    throw new Error("question must not be empty");
  }

  if (!hasQdrantConfig(env)) {
    return queryLocalCorpus(question);
  }

  // The Qdrant path is the configured one, but a dead cluster must not take the
  // demo down with it. Config presence is not upstream health: a deleted or
  // expired Qdrant Cloud cluster still leaves QDRANT_URL and QDRANT_API_KEY set,
  // and every call then 404s. Degrade to the packaged corpus instead of 500ing.
  // The response carries mode "local-corpus", so the caller sees the degrade.
  try {
    await upsertChunksWithInference(env, allLocalChunks());
    const retrievals = await searchChunksWithInference(env, question, 5);

    if (!env.ANTHROPIC_API_KEY) {
      return responseFromRetrievals(question, retrievals, "qdrant-inference");
    }

    return answerQuestion(env, question, rerankForDatasheetIdentifiers(question, retrievals));
  } catch {
    return queryLocalCorpus(question);
  }
}
