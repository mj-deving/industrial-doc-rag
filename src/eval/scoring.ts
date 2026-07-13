import { groundTruth } from "./groundTruth";
import { queryRag } from "../rag/pipeline";
import type { Config } from "../types";

export async function runEval(env: Config) {
  const cases = [];

  for (const item of groundTruth) {
    const result = await queryRag(env, item.question);
    const answerText = result.answer.toLowerCase();
    const topPart = result.retrievals[0]?.partNumber ?? "";
    const hit = result.retrievals.some((retrieval) => retrieval.partNumber === item.expectedPartNumber);
    const top1 = topPart === item.expectedPartNumber;
    const answerTerms = item.expectedTerms.every((term) => answerText.includes(term.toLowerCase()));

    cases.push({
      id: item.id,
      question: item.question,
      expectedPartNumber: item.expectedPartNumber,
      topPart,
      hit,
      top1,
      answerTerms,
      confidence: result.confidence,
      answer: result.answer,
      sources: result.sources
    });
  }

  return {
    total: cases.length,
    hitRate: ratio(cases.filter((item) => item.hit).length, cases.length),
    top1Accuracy: ratio(cases.filter((item) => item.top1).length, cases.length),
    answerTermAccuracy: ratio(cases.filter((item) => item.answerTerms).length, cases.length),
    cases
  };
}

function ratio(numerator: number, denominator: number): number {
  return Number((numerator / denominator).toFixed(3));
}
