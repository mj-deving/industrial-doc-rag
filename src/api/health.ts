import { corpus } from "../corpus/manifest";
import type { Config } from "../types";

const REQUIRED_SECRETS = ["QDRANT_URL", "QDRANT_API_KEY"] as const;

export type RequiredSecret = (typeof REQUIRED_SECRETS)[number];

// Config presence is not upstream health. `providerReady` says only that the
// secrets exist; it does NOT say the Qdrant cluster answers. A deleted or
// expired Qdrant Cloud cluster leaves both secrets set and 404s every call,
// which is exactly how this endpoint reported "ready" while /query returned 500.
// probeUpstream() is the honest check: it asks the cluster and reports the answer.
export async function probeUpstream(env: Config): Promise<{ reachable: boolean; detail: string }> {
  if (!env.QDRANT_URL || !env.QDRANT_API_KEY) {
    return { reachable: false, detail: "not configured" };
  }
  const collection = env.QDRANT_COLLECTION ?? "industrial_datasheets";
  const url = `${env.QDRANT_URL.replace(/\/$/, "")}/collections/${collection}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "api-key": env.QDRANT_API_KEY }
    });
    if (response.ok) {
      return { reachable: true, detail: "collection reachable" };
    }
    return { reachable: false, detail: `qdrant ${response.status}` };
  } catch (error) {
    return { reachable: false, detail: `qdrant unreachable: ${String(error)}` };
  }
}

export function inspectHealth(env: Config) {
  const missingSecrets = REQUIRED_SECRETS.filter((name) => !env[name]);

  return {
    ok: true,
    providerReady: missingSecrets.length === 0,
    mode: missingSecrets.length === 0 ? (env.ANTHROPIC_API_KEY ? "anthropic-qdrant" : "qdrant-inference") : "local-corpus",
    missingSecrets,
    configured: {
      anthropic: Boolean(env.ANTHROPIC_API_KEY),
      qdrantUrl: Boolean(env.QDRANT_URL),
      qdrantApiKey: Boolean(env.QDRANT_API_KEY),
      localCorpus: true
    },
    model: env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    inferenceModel: env.QDRANT_INFERENCE_MODEL ?? "sentence-transformers/all-minilm-l6-v2",
    collection: env.QDRANT_COLLECTION ?? "industrial_datasheets",
    corpusCount: corpus.length,
    endpoints: {
      ingestCorpus: "/ingest/corpus",
      query: "/query",
      eval: "/eval",
      report: "/report"
    }
  };
}
