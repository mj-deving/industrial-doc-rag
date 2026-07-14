/**
 * What the index is allowed to see, and in what shape.
 *
 * Two transforms, both found by dumping the evidence a failing question was
 * actually answered from rather than by reasoning about what it should have been.
 *
 * 1. STRIP. Asked "which package is the PMN28UNE supplied in", retrieval returned
 *    the right document and then handed the model ten chunks of copyright notice.
 *    Thirty of that document's seventy chunks are legal prose: a disclaimer footer
 *    stamped on every page, and a legal-information section that runs to the end.
 *    The model refused, and refusing was correct — there was nothing else it could
 *    honestly do with a page of liability language. The boilerplate is not noise
 *    the retriever should learn to see past; it is text that should never have been
 *    in the index, competing for ten slots against the answer.
 *
 * 2. BIND. A datasheet table names its symbol once and then lists further rows
 *    under it with the symbol column left blank:
 *
 *      ID   drain current   VGS = 10 V; Tamb = 25 °C; t ≤ 5 s   -   13   A
 *                           VGS = 10 V; Tamb = 25 °C            -    9   A
 *
 *    The second row means ID, and says so only by sitting underneath the first. A
 *    chunk boundary between them severs that, and the model is left holding a
 *    number that belongs to nothing. BUK7M19-60E's evidence contained the string
 *    `VGS = 10 V; Tmb = 25 °C; Fig. 2 - - 36 A` — the answer — with `ID drain
 *    current` cut away, and the model refused. It was right to. Binding the symbol
 *    onto its continuation rows makes the row survive the cut it will eventually
 *    meet.
 *
 * Neither transform reads the ground truth, and both would run unchanged on a
 * datasheet nobody has labelled. That is the line: this is parsing, not answering.
 * The invariant in `chunk.ts` still holds — every fact a label knows is still in
 * a chunk — and `prepare.test.ts` is what holds it, by asserting the facts survive.
 */

/** The disclaimer stamped into the footer of every page. */
const FOOTER = /All information provided in this document is subject to legal disclaimers/i;

/** The footer's companions: the print line, and the bare running header. */
const PRINT_LINE = /^\s*(Product data sheet|Product specification|Objective data sheet)\b/i;
const RUNNING_HEAD = /^\s*Nexperia\s*$/;

/** Where the technical document ends and the lawyers begin. Everything from here
 *  to the end of the file is legal text, contact addresses, and a table of
 *  contents. Nothing downstream of it has ever answered a question. */
const LEGAL_TAIL = /^\s*\d{1,2}\.\s+Legal information\b/;

export function strip(text: string): string {
  const lines = text.split("\n");
  const end = lines.findIndex((line) => LEGAL_TAIL.test(line));
  const body = end === -1 ? lines : lines.slice(0, end);

  return body
    .filter((line) => !FOOTER.test(line) && !PRINT_LINE.test(line) && !RUNNING_HEAD.test(line))
    .join("\n");
}

/**
 * A row that opens a block: an indented symbol, then the parameter name in lower
 * case. `ID    drain current   ...`. The symbol column is what a continuation row
 * lacks, so this is also the test for whether a row HAS one.
 */
const SYMBOL_ROW = /^(\s*)([A-Z][A-Za-z0-9()]{0,7})(\s{2,})([a-z][a-z\-\s]{2,}?)(\s{2,})(\S.*)$/;

/** A row ends in a unit, which is how a data row is told from a sentence. */
const DATA_ROW = /\s(-?[\d.]+|-)\s+[^\s]*\s*(V|A|W|K\/W|°C|nC|µA|mA|mΩ|Ω|nF|pF|ns|µs|mJ|Ω)\s*$/;

/** A condition clause. A continuation row is a condition plus a value, nothing else. */
const HAS_CONDITION = /[A-Za-z]+\s*=\s*-?[\d.]/;

export function bind(text: string): string {
  const out: string[] = [];
  let symbol: string | null = null;

  for (const line of text.split("\n")) {
    if (!line.trim()) {
      // Blank line ends the table block. A symbol does not reach across it, and
      // carrying one further would staple `ID` onto the next section's prose.
      symbol = null;
      out.push(line);
      continue;
    }

    const opens = SYMBOL_ROW.exec(line);
    if (opens && DATA_ROW.test(line)) {
      symbol = `${opens[2]}${opens[3]}${opens[4].trim()}`;
      out.push(line);
      continue;
    }

    // A continuation row: no symbol of its own, but it carries a condition and
    // ends in a value. It means whatever the row above it meant.
    const continuation =
      symbol !== null && !opens && HAS_CONDITION.test(line) && DATA_ROW.test(line);

    out.push(continuation ? line.replace(/^(\s*)/, `$1${symbol}   `) : line);

    // The symbol survives a line that is neither. It has to: a long parameter name
    // WRAPS, so the block reads
    //
    //   RDSon   drain-source on-state   VGS = 4.5 V; ...   -  1.1   1.4   mΩ
    //           resistance Fig. 12
    //                                   VGS = 10 V; ...    -  0.85  1.15  mΩ
    //
    // and dropping the symbol on the wrapped name orphaned the 10 V row — the very
    // row the question asks about. The model then answered from the only row still
    // carrying the name, which is the 4.5 V one, and did that on every part with a
    // two-gate-drive RDSon table. I had built the fix for orphaned rows and then
    // orphaned rows with it. Only a blank line ends the block.
  }

  return out.join("\n");
}

export function prepare(text: string): string {
  return bind(strip(text));
}
