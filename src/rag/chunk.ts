import type { CorpusDocument } from "../corpus/manifest";
import type { DatasheetChunk } from "../types";

const TARGET_CHARS = 1050;
const OVERLAP_CHARS = 160;

export function chunkText(input: {
  documentId: string;
  title: string;
  partNumber: string;
  sourceUrl: string;
  text: string;
}): DatasheetChunk[] {
  const paragraphs = normalizeText(input.text).split(/\n{2,}/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).length > TARGET_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = current.slice(Math.max(0, current.length - OVERLAP_CHARS));
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.map((text, chunkIndex) => ({
    id: `${input.documentId}-${chunkIndex}`,
    documentId: input.documentId,
    title: input.title,
    partNumber: input.partNumber,
    sourceUrl: input.sourceUrl,
    text,
    chunkIndex
  }));
}

export function chunksFromCorpusFacts(doc: CorpusDocument): DatasheetChunk[] {
  return chunkText({
    documentId: doc.documentId,
    title: doc.title,
    partNumber: doc.partNumber,
    sourceUrl: doc.sourceUrl,
    text: doc.facts.join("\n\n")
  });
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
