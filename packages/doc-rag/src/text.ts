/**
 * Text normalisation shared by the guard and the catalogue.
 *
 * It lives in its own module because the alternative was two copies, and two copies of
 * a normaliser is the most expensive bug in this project. `classOf` was written twice —
 * once for the catalogue, once for the truth generator — and the two copies disagreed
 * about whether `VGS = 10 V; Tmb = 25 °C` and `Tmb = 25 °C; VGS = 10 V` are one test
 * bench. They are. A superlative then competed 43 parts instead of 68, returned an exact
 * number, named the wrong winner, and nothing looked broken.
 *
 * This module imports nothing, so both TypeScript programs can load it.
 */

/** Every dash a datasheet can print, folded to the one a buyer types.
 *
 *  The PDF parser copies the non-breaking hyphen (U+2011) verbatim, the model writes an
 *  ASCII one, and `DFN2020MD‑6` and `DFN2020MD-6` were therefore two packages holding 16
 *  and 32 parts. Neither number is 48, and neither side is wrong about anything except
 *  typography. */
const DASHES = /[‐-―−]/g;

export const foldDashes = (text: string): string => text.replace(DASHES, "-");

/** A name is a name only where it stands alone.
 *
 *  Written with explicit boundary classes rather than `\b`, because `\b` sits between
 *  `SOT669` and `X` — so a `\b`-anchored strip of the package `SOT669` would eat the
 *  front of the part number `SOT669X-40` and leave `X-40` behind, which is not a part
 *  and would silently switch the guard off for that question. A hyphen counts as part of
 *  the name for the same reason: `SOT8002` must not match inside `SOT8002-1`. */
const boundary = (name: string) =>
  new RegExp(`(^|[^A-Za-z0-9-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9-])`, "gi");

/**
 * Remove every known name from the text, longest first.
 *
 * The guard used to subtract these as a set of exact TOKENS, and the tokens came out of
 * a regex that does not tokenise the way the vocabulary does. `Power-SO8` went in and
 * `SO8` came out; the vocabulary holds `Power-SO8`; the two never met, and the guard
 * refused a question about a package the catalogue has 139 parts of. Removing the name
 * from the TEXT cannot disagree with itself about where the name ends, because the name
 * is gone before anything tries to tokenise it.
 */
export function withoutNames(text: string, names: Iterable<string>): string {
  const longestFirst = [...names].sort((a, b) => b.length - a.length);
  let out = foldDashes(text);
  for (const name of longestFirst) out = out.replace(boundary(foldDashes(name)), "$1 ");
  return out;
}
