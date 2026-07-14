/**
 * The same questions, put to the system that has no catalogue.
 *
 * The shipped system routes a question with no part number to a table it built at ingest.
 * This asks what a plain RAG pipeline does with the identical question: retrieve ten
 * chunks across 497 datasheets, hand them to the model, read what it says. Same
 * embeddings, same k, same generator, same guard, same grader.
 *
 * It exists because a comparison against a number measured on a DIFFERENT question set is
 * not a comparison. The first baseline ran on 95 questions; the set is now 248, after the
 * label was found to hold one measurement per part and the truth for a comparison across
 * condition classes was therefore computed over a pool that was missing parts. Reporting
 * 0.863 against the old 0.021 would be putting two different experiments in one table.
 *
 * The claim under test is not "the model is bad". It is that the ANSWER IS NOT IN THE
 * EVIDENCE: a superlative over 497 documents is a property of all of them, and ten chunks
 * are ten documents. `sawWinner` is the column that says so — of the questions this
 * pipeline answers wrong, how often was the winning datasheet ever retrieved at all.
 *
 * Usage: INGEST_TOKEN=... bun tools/eval-corpus-baseline.ts <worker-url>
 */

import { measures } from "../packages/doc-rag/src/grade";
import { namedParts } from "../packages/doc-rag/src/answer";
import { withoutNames } from "../packages/doc-rag/src/text";
import { vocabulary } from "../src/api/catalog";
import type { Attributes } from "../src/api/contracts";
import type { CorpusQuestion } from "./questions-corpus";

const workerUrl = process.argv[2];
const token = process.env.INGEST_TOKEN;
if (!workerUrl || !token) {
  console.error("usage: INGEST_TOKEN=... bun tools/eval-corpus-baseline.ts <worker-url>");
  process.exit(1);
}

const REFUSAL = "NOT_IN_CORPUS";
const TOLERANCE = 0.01;
const K = 10;
const STRATEGY = "hybrid-rrf";

const catalog: Attributes[] = await Bun.file("data/attributes.json").json();
const NOT_PARTS = new Set(vocabulary(catalog).packages);
const questions: CorpusQuestion[] = await Bun.file("data/questions-corpus.json").json();

const countIsCorrect = (text: string, expected: number) =>
  [...text.matchAll(/(?<![\d.,])(\d{1,4})(?![\d.,])/g)].map((m) => Number(m[1])).includes(expected);

const valueIsCorrect = (text: string, expected: number, unit: string) =>
  measures(text).some(
    (m) => m.unit === unit && Math.abs(m.value - expected) <= Math.abs(expected) * TOLERANCE
  );

const namesPart = (text: string, parts: string[]) =>
  parts.some((part) =>
    new RegExp(`(?<![A-Za-z0-9])${part.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(?![A-Za-z0-9])`, "i").test(text)
  );

/** The harness's own response shape, and it is not the console's. `/query` returns
 *  `answer` + `sources`; `/harness/answer` returns `text` + `retrieved`. This file read
 *  the console's names against the harness's payload, got undefined for every field, and
 *  printed a flawless 0.000 with "the winner was never retrieved" at 1.00 — a number that
 *  says exactly what I expected to hear, produced by reading nothing at all. */
type Answer = { id: string; text: string; refused: boolean; retrieved?: string[] };

async function post<T>(body: unknown, attempt = 0): Promise<T> {
  const response = await fetch(`${workerUrl}/harness/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  if (response.ok) return (await response.json()) as T;
  if ((response.status >= 500 || response.status === 429) && attempt < 6) {
    await Bun.sleep(2 ** attempt * 1000);
    return post<T>(body, attempt + 1);
  }
  throw new Error(`/harness/answer: HTTP ${response.status} after ${attempt + 1} attempts`);
}

const results: Answer[] = [];
const BATCH = 8;
for (let at = 0; at < questions.length; at += BATCH) {
  const batch = questions.slice(at, at + BATCH);
  const { results: got } = await post<{ results: Answer[] }>({
    questions: batch.map((q) => ({ id: q.id, question: q.question })),
    strategy: STRATEGY,
    k: K,
    guard: true
  });
  results.push(...got);
  console.error(`  ${results.length}/${questions.length}`);
}

const cases = results.map((got, at) => {
  const q = questions[at] as CorpusQuestion;
  const text = got.text ?? "";
  const refused = text.includes(REFUSAL);
  const retrieved = got.retrieved ?? [];

  // Attributed to the mechanism that refused, never summed. The guard firing on a package
  // name is a false positive of the guard; the model declining is the honest failure.
  const refusedByGuard = refused && namedParts(withoutNames(q.question, NOT_PARTS)).length > 0;

  const correct =
    !refused &&
    (q.kind === "count"
      ? countIsCorrect(text, q.truthValue as number)
      : q.kind === "superlative-value"
        ? valueIsCorrect(text, q.truthValue as number, q.unit as string)
        : namesPart(text, q.truthParts));

  return {
    id: q.id,
    kind: q.kind,
    outcome: refused ? (refusedByGuard ? "guard-refused" : "model-refused") : correct ? "correct" : "wrong",
    /** The whole claim, in one column: could this question have been answered from what
     *  the model was shown? */
    sawWinner: refused ? null : q.truthParts.some((p) => retrieved.includes(p)),
    expected: q.kind === "superlative-part" ? q.truthParts.join(" | ") : `${q.truthValue}${q.unit ?? ""}`,
    got: text.replace(/\s+/g, " ").slice(0, 160)
  };
});

const of = (pick: (c: (typeof cases)[number]) => boolean) => cases.filter(pick).length;
const answered = cases.filter((c) => c.outcome === "correct" || c.outcome === "wrong");
const wrongAndGraded = cases.filter((c) => c.outcome === "wrong" && c.sawWinner !== null);

const summary = {
  generatedAt: new Date().toISOString(),
  questions: cases.length,
  outcomes: {
    correct: of((c) => c.outcome === "correct"),
    wrong: of((c) => c.outcome === "wrong"),
    guardRefused: of((c) => c.outcome === "guard-refused"),
    modelRefused: of((c) => c.outcome === "model-refused")
  },
  accuracy: Number((of((c) => c.outcome === "correct") / cases.length).toFixed(4)),
  precisionWhenAnswered:
    answered.length === 0
      ? 0
      : Number((answered.filter((c) => c.outcome === "correct").length / answered.length).toFixed(4)),
  /** Of the questions it answered WRONG, how many could not have been answered from the
   *  evidence it was given. This is the mechanism, and it is the reason the fix is an
   *  architecture and not a better prompt. */
  wrongWithoutSeeingWinner:
    wrongAndGraded.length === 0
      ? 0
      : Number(
          (wrongAndGraded.filter((c) => c.sawWinner === false).length / wrongAndGraded.length).toFixed(4)
        ),
  /** And across every question, how often the winning datasheet reached the model at all. */
  winnerRetrieved: Number(
    (cases.filter((c) => c.sawWinner === true).length / cases.filter((c) => c.sawWinner !== null).length).toFixed(4)
  )
};

await Bun.write("data/eval-corpus-baseline.json", JSON.stringify({ ...summary, cases }, null, 2));

console.error("");
console.error(`questions              ${summary.questions}`);
console.error(`correct                ${summary.outcomes.correct}`);
console.error(`wrong                  ${summary.outcomes.wrong}`);
console.error(`refused by the guard   ${summary.outcomes.guardRefused}`);
console.error(`refused by the model   ${summary.outcomes.modelRefused}`);
console.error("");
console.error(`accuracy                 ${summary.accuracy}`);
console.error(`precision when answered  ${summary.precisionWhenAnswered}`);
console.error(`the winner was retrieved ${summary.winnerRetrieved}`);
console.error(`wrong WITHOUT ever retrieving the winner ${summary.wrongWithoutSeeingWinner}`);
console.error("\nwrote data/eval-corpus-baseline.json");
