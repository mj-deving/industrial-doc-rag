import { corpus } from "../corpus/manifest";
import type { Env } from "../types";

const REQUIRED_SECRETS = ["ANTHROPIC_API_KEY", "COHERE_API_KEY", "QDRANT_URL", "QDRANT_API_KEY"] as const;

export type RequiredSecret = (typeof REQUIRED_SECRETS)[number];

export function inspectHealth(env: Env) {
  const missingSecrets = REQUIRED_SECRETS.filter((name) => !env[name]);

  return {
    ok: missingSecrets.length === 0,
    missingSecrets,
    configured: {
      anthropic: Boolean(env.ANTHROPIC_API_KEY),
      cohere: Boolean(env.COHERE_API_KEY),
      qdrantUrl: Boolean(env.QDRANT_URL),
      qdrantApiKey: Boolean(env.QDRANT_API_KEY)
    },
    model: env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    collection: env.QDRANT_COLLECTION ?? "industrial_datasheets",
    corpusCount: corpus.length,
    endpoints: {
      ingestDemo: "/ingest/demo",
      query: "/query",
      eval: "/eval",
      report: "/demo/report"
    }
  };
}
