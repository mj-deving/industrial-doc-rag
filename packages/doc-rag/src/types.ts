/**
 * The engine's contract with a corpus.
 *
 * Everything in `packages/doc-rag` is domain-agnostic: it knows about documents,
 * chunks, questions and answers, and nothing about MOSFETs. A corpus plugs in by
 * producing `Document`s and `Question`s. The datasheet adapter that does that for
 * Nexperia lives in `tools/`.
 *
 * The split between the two is not decoration. It is what makes the eval numbers
 * mean anything: if the engine knew what a datasheet was, it could cheat.
 */

export type Document = {
  /** Stable id. Also the retrieval label a question points at. */
  id: string;
  title: string;
  text: string;
  /** Anything the corpus wants to carry through to a citation. */
  meta?: Record<string, string | number | null>;
};

export type Chunk = {
  id: string;
  /** The `Document.id` this chunk came from. Retrieval is scored on this. */
  documentId: string;
  text: string;
  index: number;
};

export type Retrieved = {
  chunk: Chunk;
  score: number;
};

export type Expected =
  | { kind: "numeric"; value: number; unit: string; tolerance: number }
  | { kind: "text"; value: string };

export type Question = {
  id: string;
  /** The document that contains the answer. The retrieval label. */
  part: string;
  dimension: string;
  /** "holdout": the document is NOT indexed, so the only correct answer is a refusal. */
  split: "indexed" | "holdout";
  question: string;
  expected: Expected;
};

/**
 * What the system under test returns.
 *
 * `refused` is a structured flag, not a phrase we grep for in prose. Grading a
 * refusal by string-matching the answer text ("I don't have", "not found", ...)
 * measures the model's phrasing, not its behaviour, and it breaks the moment the
 * model says the same thing in different words.
 */
export type Answer = {
  text: string;
  refused: boolean;
  /** Ranked document ids behind the answer, best first. */
  retrieved: string[];
};
