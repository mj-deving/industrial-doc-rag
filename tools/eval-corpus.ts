/**
 * What the system does with a question that names no part.
 *
 * The identifier eval reports recall@1 = 1.000, and that number is a key lookup:
 * the question names the document, retrieval fetches it. This tool asks the
 * questions where there is no key. The answer to "which 40 V part has the lowest
 * RDS(on)" lives in no single datasheet. It is a property of all 497, and the
 * ten chunks a retriever returns are not the corpus.
 *
 * Two things are measured, and the second is the one worth having:
 *
 *   SCORE      how often the shipped system is right.
 *   MECHANISM  when it is wrong, WHY. Three outcomes are not the same failure and
 *              must never be summed:
 *
 *     guard-refused   The identifier guard fired. It should not have: `LFPAK33`
 *                     matches the part-number regex, so a package name is read as
 *                     a part, it is absent from the index (it is not a part), and
 *                     the guard refuses a question it was never meant to see.
 *                     A false positive, and the class of bug that gets guards
 *                     switched off.
 *     model-refused   No identifier, no guard. The model got ten chunks, saw that
 *                     a corpus-wide extremum is not in them, and declined. This is
 *                     the honest failure and it is the one to hope for.
 *     wrong           The model answered. Confidently. From ten chunks that cannot
 *                     contain the answer. This is the dangerous one, and the
 *                     `sawWinner` column says whether the true winner's datasheet
 *                     was even retrieved.
 *
 * Usage: INGEST_TOKEN=... bun tools/eval-corpus.ts <worker-url>
 */

import { namedParts } from "../packages/doc-rag/src/answer";
import { measures } from "../packages/doc-rag/src/grade";
import type { CorpusQuestion } from "./questions-corpus";

const workerUrl = process.argv[2];
const token = process.env.INGEST_TOKEN;

if (!workerUrl || !token) {
  console.error("usage: INGEST_TOKEN=... bun tools/eval-corpus.ts <worker-url>");
  process.exit(1);
}

const REFUSAL = "NOT_IN_CORPUS";
const TOLERANCE = 0.01;

type Outcome = "correct" | "wrong" | "guard-refused" | "model-refused";

type Case = {
  id: string;
  kind: CorpusQuestion["kind"];
  outcome: Outcome;
  /** Was the true winner's datasheet in the retrieved set at all? `null` when the
   *  guard refused before retrieval could matter. This is the column that turns
   *  "it got it wrong" into "it could not have got it right". */
  sawWinner: boolean | null;
  candidates: number;
  expected: string;
  got: string;
};

/** A bare integer, standalone. Deliberately LENIENT: the count is accepted if the
 *  right number appears anywhere in the answer, even surrounded by other numbers.
 *  The bias is toward the system under test, on purpose. A generous grader that
 *  still reports a failure is reporting a real one. */
function countIsCorrect(text: string, expected: number): boolean {
  const integers = [...text.matchAll(/(?<![\d.,])(\d{1,4})(?![\d.,])/g)].map((m) => Number(m[1]));
  return integers.includes(expected);
}

/** The engine's own unit-aware number parser, so a value answer is graded exactly
 *  the way the identifier eval grades one. */
function valueIsCorrect(text: string, expected: number, unit: string): boolean {
  return measures(text).some(
    (m) => m.unit === unit && Math.abs(m.value - expected) <= Math.abs(expected) * TOLERANCE
  );
}

/** A part number, matched whole. `PSMN1R0-30YLD` must not be satisfied by an
 *  answer that merely says `PSMN1R0-30YLDX`. */
function namesPart(text: string, parts: string[]): boolean {
  return parts.some((part) =>
    new RegExp(`(?<![A-Za-z0-9])${part.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(?![A-Za-z0-9])`, "i").test(text)
  );
}

async function post<T>(path: string, body: unknown, attempt = 0): Promise<T> {
  const response = await fetch(`${workerUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  if (response.ok) return (await response.json()) as T;
  const text = await response.text();
  if ((response.status >= 500 || response.status === 429) && attempt < 6) {
    await Bun.sleep(2 ** attempt * 1000);
    return post<T>(path, body, attempt + 1);
  }
  throw new Error(`${path}: HTTP ${response.status} after ${attempt + 1} attempts ${text}`);
}

type Answered = { id: string; text: string; refused: boolean; retrieved: string[] };

const questions: CorpusQuestion[] = await Bun.file("data/questions-corpus.json").json();
const byId = new Map(questions.map((q) => [q.id, q]));

// The SHIPPED path, guard on. This is what a visitor to the console gets, and the
// point of the run is what the visitor gets, not what a flag could produce.
const answers: Answered[] = [];
for (let at = 0; at < questions.length; at += 10) {
  const batch = questions.slice(at, at + 10);
  const { results } = await post<{ results: Answered[] }>("/harness/answer", {
    strategy: "hybrid-rrf",
    k: 10,
    guard: true,
    questions: batch.map((q) => ({ id: q.id, question: q.question }))
  });
  answers.push(...results);
  console.error(`  ${answers.length}/${questions.length}`);
}

const cases: Case[] = answers.map((got) => {
  const q = byId.get(got.id)!;
  const refusedByGuard = got.refused && namedParts(q.question).length > 0;
  const sawWinner = refusedByGuard ? null : q.truthParts.some((p) => got.retrieved.includes(p));

  const correct =
    q.kind === "count"
      ? countIsCorrect(got.text, q.truthValue!)
      : q.kind === "superlative-value"
        ? valueIsCorrect(got.text, q.truthValue!, q.unit!)
        : namesPart(got.text, q.truthParts);

  const outcome: Outcome = got.refused
    ? refusedByGuard
      ? "guard-refused"
      : "model-refused"
    : correct
      ? "correct"
      : "wrong";

  return {
    id: got.id,
    kind: q.kind,
    outcome,
    sawWinner,
    candidates: q.candidates,
    expected: q.kind === "superlative-part" ? q.truthParts.join(" | ") : `${q.truthValue}${q.unit ?? ""}`,
    got: got.text.replace(/\s+/g, " ").slice(0, 160)
  };
});

const rate = (subset: Case[], of: (c: Case) => boolean) =>
  subset.length === 0 ? 0 : Number((subset.filter(of).length / subset.length).toFixed(4));

const byKind = (kind: string) => cases.filter((c) => c.kind === kind);
const answered = cases.filter((c) => c.outcome === "correct" || c.outcome === "wrong");

const summary = {
  generatedAt: new Date().toISOString(),
  questions: cases.length,
  outcomes: {
    correct: cases.filter((c) => c.outcome === "correct").length,
    wrong: cases.filter((c) => c.outcome === "wrong").length,
    guardRefused: cases.filter((c) => c.outcome === "guard-refused").length,
    modelRefused: cases.filter((c) => c.outcome === "model-refused").length
  },
  accuracy: rate(cases, (c) => c.outcome === "correct"),
  /** Of the questions it chose to ANSWER, how many were right. This is the number
   *  a customer feels, because a refusal is visible and a wrong number is not. */
  precisionWhenAnswered: rate(answered, (c) => c.outcome === "correct"),
  byKind: Object.fromEntries(
    ["superlative-part", "superlative-value", "count"].map((kind) => [
      kind,
      {
        n: byKind(kind).length,
        correct: rate(byKind(kind), (c) => c.outcome === "correct"),
        wrong: rate(byKind(kind), (c) => c.outcome === "wrong"),
        guardRefused: rate(byKind(kind), (c) => c.outcome === "guard-refused"),
        modelRefused: rate(byKind(kind), (c) => c.outcome === "model-refused")
      }
    ])
  ),
  /** The mechanism claim, in one number: of the questions the model ANSWERED and
   *  got wrong, how many could not have been answered from what it was shown. */
  wrongWithoutSeeingWinner: rate(
    cases.filter((c) => c.outcome === "wrong" && c.sawWinner !== null),
    (c) => c.sawWinner === false
  )
};

await Bun.write("data/eval-corpus.json", JSON.stringify({ ...summary, cases }, null, 2));

console.error("");
console.error(`questions            ${summary.questions}`);
console.error(`correct              ${summary.outcomes.correct}`);
console.error(`wrong                ${summary.outcomes.wrong}`);
console.error(`refused by the guard ${summary.outcomes.guardRefused}   (false positives: a package is not a part)`);
console.error(`refused by the model ${summary.outcomes.modelRefused}   (honest: the answer is not in ten chunks)`);
console.error("");
console.error(`accuracy               ${summary.accuracy}`);
console.error(`precision when answered ${summary.precisionWhenAnswered}`);
console.error(`wrong without ever retrieving the winner ${summary.wrongWithoutSeeingWinner}`);
console.error("\nwrote data/eval-corpus.json");
