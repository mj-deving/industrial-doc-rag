import { corpus } from "../corpus/manifest";
import { chunksFromCorpusFacts } from "./chunk";
import { confidenceFromRetrievals } from "./answer";
import type { DatasheetChunk, QueryResponse, Retrieval } from "../types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "for",
  "in",
  "is",
  "of",
  "on",
  "the",
  "this",
  "to",
  "what",
  "which",
  "with"
]);

export function allLocalChunks(): DatasheetChunk[] {
  return corpus.flatMap((doc) => chunksFromCorpusFacts(doc));
}

export function queryLocalCorpus(question: string): QueryResponse {
  const retrievals = retrieveLocal(question, 5);
  const answer = answerFromRetrievals(question, retrievals);

  return {
    answer,
    sources: retrievals.map((item) => ({
      title: item.title,
      sourceUrl: item.sourceUrl,
      partNumber: item.partNumber,
      score: item.score,
      excerpt: item.text.slice(0, 420)
    })),
    confidence: confidenceFromRetrievals(retrievals),
    retrievals,
    mode: "local-corpus"
  };
}

export function responseFromRetrievals(question: string, retrievals: Retrieval[], mode: "qdrant-inference" | "local-corpus"): QueryResponse {
  const rankedRetrievals = rerankForDatasheetIdentifiers(question, retrievals);

  return {
    answer: answerFromRetrievals(question, rankedRetrievals),
    sources: rankedRetrievals.map((item) => ({
      title: item.title,
      sourceUrl: item.sourceUrl,
      partNumber: item.partNumber,
      score: item.score,
      excerpt: item.text.slice(0, 420)
    })),
    confidence: confidenceFromRetrievals(rankedRetrievals),
    retrievals: rankedRetrievals,
    mode
  };
}

export function rerankForDatasheetIdentifiers(question: string, retrievals: Retrieval[]): Retrieval[] {
  const queryParts = new Set(extractPartNumbers(question));
  if (queryParts.size === 0) {
    return retrievals;
  }

  // ADR: industrial datasheet queries often include exact part numbers. Dense retrieval
  // remains the broad recall layer, but exact identifiers deserve a deterministic boost
  // so questions about a named component do not land on a semantically similar neighbor.
  return retrievals
    .map((item) => {
      const partNumber = normalizePartNumber(item.partNumber);
      const exactPartBoost = queryParts.has(partNumber) ? 0.3 : 0;
      return {
        ...item,
        score: Math.min(0.99, item.score + exactPartBoost)
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function retrieveLocal(question: string, limit: number): Retrieval[] {
  const queryTokens = tokenize(question);
  const queryParts = new Set(extractPartNumbers(question));

  return allLocalChunks()
    .map((chunk) => {
      const chunkTokens = tokenize(chunk.text);
      const overlap = queryTokens.filter((token) => chunkTokens.includes(token)).length;
      const partBoost = queryParts.has(normalizePartNumber(chunk.partNumber)) ? 8 : 0;
      const score = Math.min(0.98, 0.42 + (overlap + partBoost) / Math.max(12, queryTokens.length + 8));

      return {
        ...chunk,
        score
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function answerFromRetrievals(question: string, retrievals: Retrieval[]): string {
  const top = retrievals[0];
  if (!top) {
    return "The packaged corpus does not contain enough evidence to answer this question.";
  }

  const sentence = bestSentence(question, top.text);
  return `${sentence} Evidence: ${top.partNumber}, ${top.title}.`;
}

function bestSentence(question: string, text: string): string {
  const queryTokens = tokenize(question);
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const [best] = sentences
    .map((sentence) => {
      const tokens = tokenize(sentence);
      const overlap = queryTokens.filter((token) => tokens.includes(token)).length;
      return { sentence, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap);

  return best?.sentence ?? text.slice(0, 260);
}

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/rds\(on\)/g, "rdson rds on")
        .match(/[a-z0-9]+(?:\.[0-9]+)?/g)
        ?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? []
    )
  );
}

function extractPartNumbers(value: string): string[] {
  return value
    .match(/[A-Z]{2,}[A-Z0-9-]+(?:\sG)?/gi)
    ?.map(normalizePartNumber) ?? [];
}

function normalizePartNumber(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
