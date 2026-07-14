/**
 * The planner's output is EXECUTED against 497 rows, so a spec that survives
 * validation and should not have does not produce a bad answer. It produces an
 * exact answer to a question nobody asked, with a number and a citation attached.
 * That is the most expensive kind of wrong this system can be, so the validator is
 * tested against the ways a model actually goes wrong: a package it invented, a
 * rating this corpus does not carry, a field that is not a field, prose wrapped
 * around the JSON.
 *
 * These test MY validator's contract, not the model's formatting. The formatting
 * cases below are marked, and each one is a shape a model really produced.
 */

import { describe, expect, test } from "bun:test";
import { parsePlan, type Vocabulary } from "../src/api/planner";

const vocab: Vocabulary = {
  packages: ["LFPAK56", "LFPAK33", "SOT669", "Power-SO8"],
  ratings: [30, 40, 60, 100],
  rdsonConditions: ["VGS = 10 V; Tj = 25 °C", "VGS = 4.5 V; Tj = 25 °C"],
  idConditions: ["VGS = 10 V; Tmb = 25 °C", "VGS = 10 V; Tamb = 25 °C"]
};

const plan = (text: string) => parsePlan(text, vocab);

describe("a valid plan becomes a query", () => {
  test("a superlative with conditions", () => {
    const got = plan(
      '{"route":"catalog","spec":{"op":"min","field":"rdson","filters":{"channel":"N","vds":40,"conditions":"VGS = 10 V; Tj = 25 °C"}}}'
    );
    expect(got).toEqual({
      route: "catalog",
      spec: { op: "min", field: "rdson", filters: { channel: "N", vds: 40, conditions: "VGS = 10 V; Tj = 25 °C" } }
    });
  });

  test("a count needs no field", () => {
    const got = plan('{"route":"catalog","spec":{"op":"count","filters":{"package":"LFPAK33"}}}');
    expect(got).toEqual({ route: "catalog", spec: { op: "count", filters: { package: "LFPAK33" } } });
  });

  test("a question about one part is sent to retrieval, which is good at those", () => {
    expect(plan('{"route":"lookup"}')).toEqual({ route: "lookup" });
  });
});

describe("what the corpus does not contain cannot be filtered on", () => {
  test("an invented package is refused, not answered with zero", () => {
    // "0 parts come in a TO-220 package" is true and useless. It reads as a fact
    // about the corpus when it is a fact about the plan.
    expect(plan('{"route":"catalog","spec":{"op":"count","filters":{"package":"TO-220"}}}')).toEqual({
      route: "unsupported"
    });
  });

  test("a rating the corpus does not carry is refused", () => {
    expect(
      plan('{"route":"catalog","spec":{"op":"min","field":"rdson","filters":{"vds":250}}}')
    ).toEqual({ route: "unsupported" });
  });

  test("a field that is not a field is refused", () => {
    expect(
      plan('{"route":"catalog","spec":{"op":"min","field":"gate_charge","filters":{}}}')
    ).toEqual({ route: "unsupported" });
  });

  test("an operation that is not an operation is refused", () => {
    expect(plan('{"route":"catalog","spec":{"op":"average","field":"rdson","filters":{}}}')).toEqual({
      route: "unsupported"
    });
  });

  test("a min/max with no field at all is refused rather than defaulted", () => {
    // A default here would silently rank on-resistance when the question asked about
    // current, and the answer would be exact, cited, and about the wrong parameter.
    expect(plan('{"route":"catalog","spec":{"op":"max","filters":{"vds":40}}}')).toEqual({
      route: "unsupported"
    });
  });
});

describe("the sign and the spelling of a filter", () => {
  test("a P-channel rating is matched on magnitude: -30 V is a 30 V part", () => {
    const got = plan('{"route":"catalog","spec":{"op":"count","filters":{"channel":"P","vds":-30}}}');
    expect(got).toEqual({ route: "catalog", spec: { op: "count", filters: { channel: "P", vds: 30 } } });
  });

  test("a package is matched case-insensitively and stored under its true name", () => {
    const got = plan('{"route":"catalog","spec":{"op":"count","filters":{"package":"lfpak56"}}}');
    expect(got.route === "catalog" && got.spec.filters.package).toBe("LFPAK56");
  });

  test("the same test bench written in the other order is the same test bench", () => {
    // The corpus files this bench as `VGS = 10 V; Tj = 25 °C`. A question that names
    // the temperature first names the same one. Compared as raw strings, the planner
    // finds no match, silently drops the filter, and answers across every gate drive
    // instead of the one it was given.
    const got = plan(
      '{"route":"catalog","spec":{"op":"min","field":"rdson","filters":{"conditions":"Tj = 25 °C; VGS = 10 V"}}}'
    );
    expect(got.route === "catalog" && got.spec.filters.conditions).toBe("VGS = 10 V; Tj = 25 °C");
  });

  test("a condition the corpus does not quote is DROPPED, not refused", () => {
    // Dropping it makes the catalogue answer per class, which is strictly more
    // informative than a refusal and is the honest response to a question that did
    // not pin a gate drive.
    const got = plan(
      '{"route":"catalog","spec":{"op":"min","field":"rdson","filters":{"vds":40,"conditions":"VGS = 12 V"}}}'
    );
    expect(got.route === "catalog" && got.spec.filters.conditions).toBeUndefined();
    expect(got.route === "catalog" && got.spec.filters.vds).toBe(40);
  });
});

describe("the shapes a model actually sends", () => {
  test("JSON wrapped in prose is still read", () => {
    const got = plan(
      'Here is the query:\n\n{"route":"catalog","spec":{"op":"count","filters":{"package":"LFPAK56"}}}\n\nLet me know if you need more.'
    );
    expect(got.route).toBe("catalog");
  });

  test("JSON in a fenced block is still read", () => {
    const got = plan('```json\n{"route":"lookup"}\n```');
    expect(got).toEqual({ route: "lookup" });
  });

  test("an empty answer is unsupported, never a silent default", () => {
    expect(plan("")).toEqual({ route: "unsupported" });
    expect(plan("I cannot answer that.")).toEqual({ route: "unsupported" });
  });

  test("truncated JSON is unsupported rather than half-executed", () => {
    expect(plan('{"route":"catalog","spec":{"op":"min","field":"rdso')).toEqual({ route: "unsupported" });
  });
});
