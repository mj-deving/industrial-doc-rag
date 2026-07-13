/**
 * The index/holdout split.
 *
 * Two consumers need to agree on this: the ingester (which must NOT index a
 * holdout datasheet) and the question generator (which must mark a holdout
 * question as expecting a refusal). If they disagree by even one part, the
 * refusal measurement is silently wrong: the system answers correctly from a
 * document we claimed it could not see, and we score that as a hallucination.
 *
 * So the split is a pure function of the part number, not a file. There is no
 * artefact to go stale and no second copy to drift.
 *
 * FNV-1a is used because it is stable across runs and machines, unlike
 * Bun.hash (which is seeded) or a JS Map iteration order.
 */

/** Share of the corpus held out of the index, in percent. */
export const HOLDOUT_PERCENT = 28;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * True when the part is held out: its datasheet is never indexed, so the only
 * correct answer to a question about it is "I do not have that document".
 */
export function isHoldout(part: string): boolean {
  return fnv1a(part) % 100 < HOLDOUT_PERCENT;
}

export type Split = { indexed: string[]; holdout: string[] };

export function splitParts(parts: string[]): Split {
  const indexed: string[] = [];
  const holdout: string[] = [];
  for (const part of parts) (isHoldout(part) ? holdout : indexed).push(part);
  return { indexed, holdout };
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: bun tools/split.ts <groundtruth.json>");
    process.exit(1);
  }
  const labels: { part: string }[] = await Bun.file(path).json();
  const { indexed, holdout } = splitParts(labels.map((l) => l.part));
  console.error(`${indexed.length} indexed, ${holdout.length} holdout (${HOLDOUT_PERCENT}% target)`);
  for (const part of holdout) console.log(part);
}
