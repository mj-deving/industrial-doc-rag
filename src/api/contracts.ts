/**
 * The wire contract between the ingest client and the Worker.
 *
 * This module imports NOTHING, and that is its whole job. `tools/ingest.ts` runs
 * under Bun and the Worker runs under workerd, and the two runtimes declare
 * colliding globals: `@cloudflare/workers-types` supplies a `Blob` with no
 * `.json()`, `BunFile` extends `Blob`, and any TypeScript program that loads both
 * type packages therefore rejects every `Bun.file(path).json()` in `tools/`.
 *
 * So there are two programs (`tsconfig.json`, `tsconfig.tools.json`), and the one
 * shared type sits here where both can read it without dragging the other's
 * globals along. The client used to keep a hand-copy of this shape instead, and it
 * silently went out of sync: `total` was missing, and the prune it feeds deleted a
 * third of the index.
 */

export type IngestChunk = {
  id: string;
  part: string;
  text: string;
  index: number;
  /**
   * How many chunks this part has IN TOTAL, not how many are in this request.
   *
   * The prune needs to know where the document ends. It cannot learn that from the
   * payload, because the payload is a fixed-size slice of a stream of chunks from
   * many parts and a long document spans several requests. Reading the end from the
   * payload gives a different, WRONG answer in each one. So the client, which is
   * the only party that knows, says.
   */
  total: number;
};

/** How far past a document's last chunk to sweep for the previous ingest's leftovers.
 *  The longest datasheet in this corpus chunked to 79 before boilerplate stripping and
 *  54 after, so the debris a re-chunk leaves is tens of ids, not hundreds. 80 covers a
 *  document that halves in size; it is slack, not a guess, and every id past the real
 *  end is a no-op delete that still costs a round trip to Vectorize. */
const OVERHANG = 80;

/**
 * The ids to sweep after writing `chunks`: everything from each part's declared end
 * out to the overhang.
 *
 * The property that matters is that this depends ONLY on `total`, never on which
 * chunks the request happens to carry. Two concurrent requests holding different
 * halves of the same document must compute the same range, or one of them deletes
 * the other's writes. `ingest.test.ts` is what holds that.
 *
 * It lives here rather than in the Worker route because its test is Bun-side, and a
 * value import from the route would drag workerd's globals into that program.
 */
export function staleIds(chunks: IngestChunk[]): string[] {
  const ends = new Map(chunks.map((chunk) => [chunk.part, chunk.total]));
  return [...ends].flatMap(([part, total]) =>
    Array.from({ length: OVERHANG }, (_, i) => `${part}#${total + i}`)
  );
}
