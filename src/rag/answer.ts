import Anthropic from "@anthropic-ai/sdk";
import type { Env, QueryResponse, Retrieval } from "../types";

export async function answerQuestion(env: Env, question: string, retrievals: Retrieval[]): Promise<QueryResponse> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }
  const anthropic = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY
  });

  const context = retrievals
    .map((item, index) => {
      return `[${index + 1}] ${item.title} (${item.partNumber}) score=${item.score.toFixed(3)}\n${item.text}`;
    })
    .join("\n\n");

  // ADR: Haiku-class generation keeps the query latency bounded. The answer is forced
  // to stay inside retrieved snippets so the Loom can inspect sources instead of trust prose.
  const message = await anthropic.messages.create({
    model: env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    max_tokens: 500,
    temperature: 0.1,
    system: "You answer industrial datasheet questions. Use only the provided snippets. If the snippets do not contain the answer, say that the corpus does not contain enough evidence. Be concise and include units.",
    messages: [
      {
        role: "user",
        content: `Question: ${question}\n\nRetrieved snippets:\n${context}\n\nReturn the direct answer first, then one short evidence note.`
      }
    ]
  });

  const answer = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return {
    answer,
    sources: retrievals.map((item) => ({
      title: item.title,
      sourceUrl: item.sourceUrl,
      partNumber: item.partNumber,
      score: item.score,
      excerpt: item.text.slice(0, 420)
    })),
    confidence: confidenceFromRetrievals(retrievals),
    retrievals,
    mode: "anthropic-qdrant"
  };
}

export function confidenceFromRetrievals(retrievals: Retrieval[]): "low" | "medium" | "high" {
  const top = retrievals[0]?.score ?? 0;
  const second = retrievals[1]?.score ?? 0;
  if (top > 0.78 && top - second > 0.06) {
    return "high";
  }
  if (top > 0.68) {
    return "medium";
  }
  return "low";
}
