/**
 * Chunking.
 *
 * One rule drives the whole file: the index must see EXACTLY the text the ground
 * truth was parsed from. Both come from the same `pdftotext -layout` render, so a
 * fact the label knows is a fact the chunk contains. If they used different
 * extractors, an unanswerable question would look like a retrieval failure, and
 * we would spend a week tuning a retriever against a bug in a PDF parser.
 *
 * The layout render keeps table columns aligned with runs of spaces, and that
 * alignment is the only thing that makes a quick-reference table readable at all.
 * So whitespace is preserved inside a line and collapsed only between blocks.
 */

import type { Chunk, Document } from "./types";

const TARGET_CHARS = 1100;
const OVERLAP_CHARS = 180;

/**
 * A hard ceiling, not a target.
 *
 * Packing by blocks alone leaves a block LARGER than the target unsplit, and
 * `pdftotext -layout` produces exactly that: a table page with no blank line in
 * it is one block, and one datasheet in this corpus yielded a single 13.8 KB
 * chunk. Two things go wrong at once. Vectorize refuses metadata over 10 KB, so
 * ingestion fails loudly, which is the lucky half. The unlucky half is that a
 * 13 KB chunk averages an entire page into one point in the embedding space,
 * where it is close to nothing and retrievable by nothing.
 */
const MAX_CHARS = 1800;

/** Split a block that is too big to be a chunk on its own, on line boundaries. */
function split(block: string): string[] {
  if (block.length <= MAX_CHARS) return [block];

  const pieces: string[] = [];
  let piece = "";
  for (const line of block.split("\n")) {
    if (piece && (piece + "\n" + line).length > TARGET_CHARS) {
      pieces.push(piece);
      piece = "";
    }
    // A single line longer than the ceiling is not a line, it is a run of glued
    // table cells. Cut it, rather than let it through and fail at the index.
    if (line.length > MAX_CHARS) {
      for (let at = 0; at < line.length; at += TARGET_CHARS) {
        pieces.push(line.slice(at, at + TARGET_CHARS));
      }
      continue;
    }
    piece = piece ? `${piece}\n${line}` : line;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

export function chunk(document: Document): Chunk[] {
  const blocks = normalise(document.text)
    .split(/\n{2,}/)
    .filter((b) => b.trim())
    .flatMap(split);

  const texts: string[] = [];
  let current = "";

  for (const block of blocks) {
    if (current && (current + "\n\n" + block).length > TARGET_CHARS) {
      texts.push(current.trim());
      // Carry a tail forward so a fact split across the seam survives in one of
      // the two halves. A table row is short; the overlap is longer than a row.
      current = current.slice(-OVERLAP_CHARS);
    }
    current = current ? `${current}\n\n${block}` : block;
  }
  if (current.trim()) texts.push(current.trim());

  return texts.map((text, index) => ({
    id: `${document.id}#${index}`,
    documentId: document.id,
    text,
    index
  }));
}

function normalise(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/\f/g, "\n\n") // a page break is a block boundary, not a character
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
