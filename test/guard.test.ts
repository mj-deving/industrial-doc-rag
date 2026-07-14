/**
 * The identifier guard refuses a question whose named part is not in the corpus. This
 * pins the false-positive side: a question that names no part at all must never be
 * refused, and a package name is not a part.
 *
 * Every fixture below is a question the shipped system actually refused on 2026-07-14,
 * copied from `data/eval-corpus.json`. Three of the 40 count questions were answered
 * with NOT_IN_CORPUS — including one about a package the catalogue holds 139 parts of.
 */

import { describe, expect, test } from "bun:test";
import { guardRefuses, namedParts } from "../packages/doc-rag/src/answer";
import { withoutNames } from "../packages/doc-rag/src/text";

/** The package vocabulary as the catalogue actually spells it. */
const PACKAGES = new Set(["Power-SO8", "SOT669", "LFPAK33", "SOT1220", "DFN2020MD-6", "SOT8002"]);

const count = (pkg: string) => `In this corpus, how many parts are offered in a ${pkg} package?`;

describe("a package name is not a part number", () => {
  test("the guard does not refuse a count over a package it holds 139 parts of", () => {
    // The bug, exactly: the identifier regex reads `Power-SO8` and returns `SO8`, which
    // is not a key in the package vocabulary, so the guard concluded the question named
    // an unknown part and refused. The vocabulary was right, the regex was right, and
    // they disagreed about where the name ends.
    expect(guardRefuses(count("Power-SO8"), [], PACKAGES)).toBe(false);
  });

  test("nor one whose name the regex truncates at a character it does not know", () => {
    // U+2011. The regex stops at the non-breaking hyphen and hands the guard
    // `DFN2020MD`; the vocabulary has `DFN2020MD-6`.
    expect(guardRefuses(count("DFN2020MD‑6"), [], PACKAGES)).toBe(false);
    // And the version suffix, from the other side: the question says `SOT8002`, the
    // catalogue wrote `SOT8002-1`.
    expect(guardRefuses(count("SOT8002"), [], PACKAGES)).toBe(false);
  });

  test("a package name the corpus does not have is still not a part number", () => {
    // No refusal, because there is no document to be missing. A question about an
    // unknown package is answered (with zero) by the catalogue, not refused by a guard
    // that mistook the package for a datasheet.
    expect(guardRefuses(count("TO-220"), [], PACKAGES)).toBe(false);
  });

  test("the guard still refuses a part that is genuinely not in the corpus", () => {
    // The whole point of the guard, unchanged. The holdout part is named, nothing
    // retrieved came from it, and the model would otherwise decode the name and answer.
    expect(guardRefuses("What is the VDS of PSMN1R0-30YLD?", ["PSMN2R0-30YLD"], PACKAGES)).toBe(true);
  });

  test("and answers one it did retrieve", () => {
    expect(guardRefuses("What is the VDS of PSMN1R0-30YLD?", ["PSMN1R0-30YLD"], PACKAGES)).toBe(false);
  });

  test("a part number that contains a package name is still a part number", () => {
    // The strip must not eat a document. Guards against the naive fix: a blind
    // substring removal would turn a real part into a fragment and stop refusing.
    expect(guardRefuses("What is the VDS of SOT669X-40?", ["PSMN1R0-30YLD"], PACKAGES)).toBe(true);
  });
});

/**
 * The router asks the same question the guard does — "does this name a document?" — and
 * it asked it with its own copy of the subtraction. The guard was fixed; the copy was
 * not; and the question about Power-SO8 stopped being refused and started being answered
 * by retrieval, which reads ten datasheets to answer something about 139. A refusal at
 * least says it does not know.
 *
 * So the composition the router actually evaluates is pinned here, not just the guard.
 */
describe("the routing decision, exactly as the router computes it", () => {
  const routes = (question: string) => namedParts(withoutNames(question, PACKAGES));

  test("a question that names only a package names no document", () => {
    for (const pkg of PACKAGES) expect(routes(count(pkg))).toEqual([]);
  });

  test("a question that names a part still names a document", () => {
    expect(routes("What is the VDS of PSMN1R0-30YLD?")).toEqual(["PSMN1R0-30YLD"]);
  });

  test("and a question that names both names the part", () => {
    expect(routes("Is PSMN1R0-30YLD offered in a Power-SO8 package?")).toEqual(["PSMN1R0-30YLD"]);
  });
});
