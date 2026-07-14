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

/**
 * One row of the catalogue: what the model read out of one datasheet.
 *
 * The conditions travel WITH the value and are not metadata about it. RDS(on) is
 * quoted at a gate voltage, and this corpus quotes it at five different ones, so a
 * row that stored 4.1 mΩ without `VGS = 4.5 V` would let a query rank that part
 * against another part's test bench.
 */
export type Measured = { value: number; unit: string; conditions: string };

export type Attributes = {
  part: string;
  /**
   * Read from the datasheet's first sentence, not inferred from the sign of anything.
   *
   * It used to be inferred: a P-channel part quotes a negative rating, so `vds < 0`
   * meant P. That held until a prompt change made the model read the em-dash in an
   * empty Min column as a minus sign, and 67 N-channel parts came back rated -60 V.
   * They did not become slightly wrong. They became P-channel parts — they left every
   * N-channel comparison they belonged in and entered every P-channel one they did not.
   *
   * A categorical fact that is carried by the sign bit of a different field is one
   * typographic accident away from being the opposite fact. Every datasheet opens with
   * "N-channel enhancement mode Field-Effect Transistor", so it is read, not derived.
   */
  channel: "N" | "P" | null;
  /** Signed as the datasheet prints it. A P-channel part is negative. */
  vds: number | null;
  /**
   * EVERY row, not the row. A datasheet quotes on-resistance at more than one gate
   * drive: the same die reads 2.4 mΩ at VGS = 10 V and 3.6 mΩ at VGS = 4.5 V, and
   * both are true.
   *
   * The first version of this type stored one measurement, and it was wrong in a way
   * that produces a confident wrong answer rather than a missing one. If the model
   * happened to record the 4.5 V row, the part vanished from every comparison at
   * 10 V, and a superlative over that class returned the best of the parts that
   * remained. The winner would be wrong, the number exact, and nothing would look
   * broken. Measured on the first extraction: 35 of 426 parts landed in a class the
   * datasheet does not put them in alone.
   */
  rdson: Measured[];
  id: Measured[];
  /** Every name the ordering table prints. A package has more than one true name. */
  package: string[];
};

/**
 * Where a model's free text becomes data.
 *
 * The extraction reads the datasheet correctly and writes it down the way a person
 * would, which is not the way a table wants it:
 *
 *   conditions   `VGS = 10 V; ID = 20 A; Tj = 25 °C; Fig. 12`   the figure reference rode along
 *   package      `LFPAK56; Power-SO8 (SOT669)`                  three names in one string
 *
 * Left alone, both are silent product defects rather than cosmetic ones. A row
 * whose package is the single string `TO-236AB (SOT23)` is invisible to a count
 * filtered on `SOT23`, and a condition string carrying `Fig. 12` lands in a
 * condition class of its own, so the part is compared against nobody.
 *
 * These were first read as extraction errors — agreement with the label came out at
 * 0.51 on conditions and 0.61 on packages — and the disagreements turned out to be
 * almost entirely this. The model had read the datasheet right. The comparison, and
 * the storage, were wrong. That is the fourth time in this project that a number
 * blamed the system and meant the instrument.
 */

/**
 * A condition term the corpus actually measures under. Everything else in the string (a
 * figure reference, a stray semicolon) is not a condition.
 *
 * ── The duration term is here because leaving it out was the worst bug in this file ──
 *
 * This was a whitelist of V, T and ID terms, written to strip `Fig. 12`. `t <= 5 s` is
 * none of those, so it was stripped as well — and a duration limit is not typography. It
 * is the ONLY thing separating two rows a datasheet prints one above the other:
 *
 *     ID   drain current   VGS = 10 V; Tamb = 25 °C; t <= 5 s    8    A
 *     ID   drain current   VGS = 10 V; Tamb = 25 °C              6.1  A
 *
 * Same gate drive, same ambient; the top row is 30% higher and holds for five seconds.
 * Strip the qualifier and the two collapse into one condition class, the pulsed figure is
 * stored as a continuous rating, and it wins every "which part carries the highest
 * current" it is entered into — because a query for an extremum selects FOR errors that
 * make a value more extreme. An error rate a lookup would shrug off is fatal to a
 * superlative, and it is fatal precisely at the top of the table, where the answer is.
 *
 * The prompt already told the model not to report a time-limited rating. It is now told
 * to copy the duration too, so that when it reports one anyway, the row lands in a class
 * of its own and is compared against nobody. The instruction is a request; the class is
 * a guarantee.
 */
const CONDITION_TERM = /^(V(?:GS|DS)|T(?:j|mb|amb)|ID)\s*=|^t\s*[≤<]/i;

/** Keep the terms that state a condition, in the order printed. */
export function cleanConditions(conditions: string): string {
  return conditions
    .split(";")
    .map((term) => term.trim())
    .filter((term) => CONDITION_TERM.test(term))
    .join("; ");
}

/**
 * The condition CLASS of a measurement: its conditions with the drain current
 * dropped, and its terms in a canonical order.
 *
 * `ID = 10 A` varies part to part (it tracks the part's own rating) and barely moves
 * on-resistance. The gate voltage and the temperature symbol do. Dropping the
 * current collapses this corpus's 150 distinct condition strings into six real
 * classes, and keeping `Tmb` (mounting base, which assumes a heatsink) apart from
 * `Tamb` (free air) stops a thermal assumption from winning a comparison.
 *
 * Two parts may be ranked against each other only if their classes are equal, and
 * THAT is why the terms are sorted. A datasheet prints `VGS = 10 V; Tmb = 25 °C` and
 * the one beside it prints `Tmb = 25 °C; VGS = 10 V`, and the two are the same test
 * bench. Measured on the real extraction: 43 parts written the first way, 25 the
 * second. Measured on the label file: 276 and 100. Keying the class on the printed
 * order made them two classes, so a superlative over that class competed 43 parts
 * instead of 68 and returned the best of a subset — an exact number, the wrong
 * winner, and nothing that looks broken. The order the datasheet prints its
 * conditions in is typography. It is not a condition.
 *
 * The truth generator (`tools/questions-corpus.ts`) already sorted, which is the only
 * reason the ground truth for these questions is not wrong in the same way.
 */
export function classOf(conditions: string): string {
  return cleanConditions(conditions)
    .split(";")
    .map((term) => term.trim())
    .filter((term) => !/^ID\s*=/i.test(term))
    .sort()
    .join("; ");
}

/**
 * Split the names a model wrote as prose into the names the ordering table prints.
 *
 * `LFPAK56; Power-SO8 (SOT669)` is three names, and every one of them is a true
 * name for that package. A buyer searching any of them means the same part.
 */
/**
 * A package name is a DESIGNATOR, not a description.
 *
 * The ordering table prints `TSOP6  plastic, surface-mounted package (SC-74)`, and
 * the names in there are `TSOP6` and `SC-74`. The rest is the datasheet describing
 * the thing rather than naming it. A splitter that kept it would put `plastic` in
 * the catalogue's vocabulary, and a customer filtering on `plastic` would get
 * matches, which is worse than getting none.
 *
 * Two properties separate the two, and both hold across every name this corpus
 * prints (SOT669, Power-SO8, LFPAK, LFPAK56D, TO-236AB, SC-74, D2PAK, CCPAK1212):
 * a designator carries an uppercase letter or a digit, and it has no space in it.
 */
function isPackageName(name: string): boolean {
  return name.length >= 2 && name.length <= 24 && !/\s/.test(name) && /[A-Z0-9]/.test(name);
}

/** Every dash a datasheet prints, folded to the one a buyer types.
 *
 *  The label preserves the PDF's non-breaking hyphen (U+2011); the model writes an ASCII
 *  one. So `DFN2020MD‑6` and `DFN2020MD-6` were two packages holding 16 and 32 parts.
 *  Neither number is 48, and neither side is wrong about anything except typography. */
const DASHES = /[‐-―−]/g;

/** A SOT code with a numeric version suffix is a variant of that SOT code, and a buyer
 *  asking for SOT1220 means all of them.
 *
 *  Confirmed against the label rather than assumed: all 18 parts the model filed under
 *  `SOT1220-2`, both under `SOT1220-4`, and all 7 under `SOT8002-1` are labelled
 *  `SOT1220` / `SOT8002` by a parser that read the ordering table's own columns. The
 *  version is a column in that table, not a different package.
 *
 *  Deliberately narrow. `DFN2020MD-6` is a six-lead DFN2020MD and the label never writes
 *  `DFN2020MD` alone, so a general strip-the-trailing-number rule would invent a package
 *  nobody sells. Only a SOT code takes a version suffix. */
const SOT_VERSION = /^(SOT\d{3,})-\d+$/;

export function cleanPackages(names: string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    for (const piece of raw.replace(DASHES, "-").split(/[;,]|\s{2,}/)) {
      // A parenthesised alternative is a name, not a gloss: `TO-236AB (SOT23)`.
      for (const candidate of piece.split(/[()]/)) {
        const name = candidate.trim();
        if (!isPackageName(name)) continue;
        out.add(name);
        const base = name.match(SOT_VERSION);
        if (base?.[1]) out.add(base[1]);
      }
    }
  }

  /**
   * A name that is the tail of another name ON THE SAME PART is a fragment of it.
   *
   * `SO8` is what is left of `Power-SO8` when a sentence breaks it: every datasheet in
   * this family carries the bullet "LFPAK provides maximum power density in a Power SO8
   * package", and the token `SO8` stands alone in it. The label's own parser fell for it
   * first — `PSMN012-100YS` was labelled `SO8`, which is defect three in the README — and
   * when the extraction prompt was changed to "list every name printed in the excerpts",
   * the model reproduced the same error on 4 parts. All 23 rows that carry `SO8` also
   * carry `Power-SO8`, so the row itself says which one is the designator.
   *
   * Suffix-only, and that is the whole safety of it: `LFPAK56` does not end in `-LFPAK`
   * and `SOT1220-2` does not end in `-SOT1220`, so a family name and a version fold both
   * survive. And a part whose ONLY name is `SO8` keeps it — there is nothing for it to be
   * a fragment of. The rule reads the row, not a list of words I decided were bad.
   */
  for (const name of [...out]) {
    const whole = [...out].some(
      (other) => other !== name && new RegExp(`[-\\s]${name}$`).test(other)
    );
    if (whole) out.delete(name);
  }
  return [...out];
}

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
