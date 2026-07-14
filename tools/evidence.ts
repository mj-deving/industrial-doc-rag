/**
 * Print what the model was actually shown.
 *
 * Every defect found in this system so far was found by looking at the real
 * artefact rather than reasoning about it: the label that disagreed with the
 * datasheet it was parsed from, the response shape the shipped types did not
 * describe, the token ceiling a reasoning model spent on reasoning. Each time,
 * the fix was to stop inferring and dump the thing.
 *
 * The failure class this exists for: the model is handed ten excerpts, refuses,
 * and the harness records "NOT_IN_CORPUS" without recording the ten excerpts. The
 * refusal is then equally consistent with a model that ignored its evidence and a
 * model that was never given any, and the two want opposite fixes.
 *
 * Usage: INGEST_TOKEN=... bun tools/evidence.ts <worker-url> <question-id>...
 */

import { grade } from "../packages/doc-rag/src/grade";
import type { Question } from "../packages/doc-rag/src/types";

const workerUrl = process.argv[2];
const ids = process.argv.slice(3);
const token = process.env.INGEST_TOKEN;

if (!workerUrl || !token || ids.length === 0) {
  console.error("usage: INGEST_TOKEN=... bun tools/evidence.ts <worker-url> <question-id>...");
  process.exit(1);
}

const questions: Question[] = await Bun.file("data/questions.json").json();
const asked = ids.map((id) => {
  const found = questions.find((q) => q.id === id);
  if (!found) throw new Error(`no such question: ${id}`);
  return found;
});

type Result = {
  id: string;
  text: string;
  refused: boolean;
  retrieved: string[];
  evidence: { part: string; text: string }[];
};

const response = await fetch(`${workerUrl}/harness/answer`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({
    strategy: "hybrid-rrf",
    evidence: true,
    questions: asked.map((q) => ({ id: q.id, question: q.question }))
  })
});

if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
const { results } = (await response.json()) as { results: Result[] };

for (const result of results) {
  const question = asked.find((q) => q.id === result.id)!;
  const verdict = grade(question, result);
  const want = question.expected.kind === "text"
    ? question.expected.value
    : `${question.expected.value} ${question.expected.unit}`;

  console.log(`\n${"=".repeat(78)}`);
  console.log(`${question.id}   [${question.split}]`);
  console.log(`Q: ${question.question}`);
  console.log(`expected: ${want}`);
  console.log(`answered: ${JSON.stringify(result.text.slice(0, 160))}`);
  console.log(`graded:   ${verdict.correct ? "correct" : "WRONG"} (${verdict.reason})`);
  console.log(`${"-".repeat(78)}`);

  // The whole point. Does the answer to the question appear anywhere in the ten
  // excerpts the model was handed? If yes, a refusal is the generator's failure.
  // If no, the generator was asked to invent, and refusing was the right call.
  const carries = (text: string) =>
    question.expected.kind === "text" && text.toLowerCase().includes(want.toLowerCase());

  result.evidence.forEach((excerpt, at) => {
    const flag = carries(excerpt.text) ? "  <<< CARRIES THE ANSWER" : "";
    const preview = excerpt.text.replace(/\s+/g, " ").slice(0, 100);
    console.log(`[${String(at).padStart(2)}] ${excerpt.part.padEnd(16)} ${preview}${flag}`);
  });

  const hits = result.evidence.filter((e) => carries(e.text)).length;
  console.log(`${"-".repeat(78)}`);
  console.log(
    hits > 0
      ? `The evidence CONTAINS the answer in ${hits} of ${result.evidence.length} excerpts. A miss here is the generator's.`
      : `The evidence does NOT contain the answer. The generator could only have invented it.`
  );
}
