import { findCorpusByUrl } from "../corpus/manifest";
import { chunksFromCorpusFacts } from "./chunk";
import type { DatasheetChunk } from "../types";

export async function chunksFromPdfUrl(pdfUrl: string, documentId?: string): Promise<DatasheetChunk[]> {
  validatePdfUrl(pdfUrl);
  const response = await fetch(pdfUrl, {
    headers: {
      "user-agent": "industrial-doc-rag/0.1 (+https://github.com/mj-deving/industrial-doc-rag)"
    }
  });

  if (!response.ok) {
    throw new Error(`PDF fetch failed with ${response.status} ${response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const known = findCorpusByUrl(pdfUrl);
  const extracted = extractPdfText(bytes);

  if (extracted.length > 1200) {
    const { chunkText } = await import("./chunk");
    return chunkText({
      documentId: documentId ?? known?.documentId ?? stableId(pdfUrl),
      title: known?.title ?? `Imported datasheet ${documentId ?? stableId(pdfUrl)}`,
      partNumber: known?.partNumber ?? documentId ?? stableId(pdfUrl),
      sourceUrl: pdfUrl,
      text: extracted
    });
  }

  if (known) {
    // ADR: Cloudflare Workers cannot run common Node PDF parsers. For the demo corpus,
    // fetching the public PDF proves the URL path and these curated chunks keep ingestion
    // deterministic when the PDF stream is compressed or font-encoded.
    return chunksFromCorpusFacts(known);
  }

  throw new Error("PDF text extraction produced too little text and no curated corpus fallback matched this URL");
}

export function extractPdfText(bytes: Uint8Array): string {
  const binary = new TextDecoder("latin1").decode(bytes);
  const strings = Array.from(binary.matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g), (match) => unescapePdfString(match[1]));
  const arrayStrings = Array.from(binary.matchAll(/\[((?:\s*\([^()\\]*(?:\\.[^()\\]*)*\)\s*)+)\]\s*TJ/g), (match) => {
    return Array.from(match[1].matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g), (inner) => unescapePdfString(inner[1])).join("");
  });
  return [...strings, ...arrayStrings]
    .join("\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unescapePdfString(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function stableId(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `doc-${hash.toString(16)}`;
}

function validatePdfUrl(pdfUrl: string): void {
  const parsed = new URL(pdfUrl);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("pdfUrl must be http or https");
  }
  if (!parsed.pathname.toLowerCase().endsWith(".pdf")) {
    throw new Error("pdfUrl must point to a .pdf path");
  }
}
