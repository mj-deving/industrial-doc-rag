import { describe, expect, it } from "bun:test";
import { badRequest, missingSecretError, toApiError } from "../src/api/errors";
import { inspectHealth } from "../src/api/health";
import { consoleQuestions } from "../src/console/questions";
import { runEval } from "../src/eval/scoring";
import { rerankForDatasheetIdentifiers } from "../src/rag/local";
import { queryRag } from "../src/rag/pipeline";
import type { Retrieval } from "../src/types";

describe("health", () => {
  it("reports missing secrets without exposing configured values", () => {
    const health = inspectHealth({
      ANTHROPIC_API_KEY: "secret",
      QDRANT_COLLECTION: "industrial_collection"
    });

    expect(health.ok).toBe(true);
    expect(health.providerReady).toBe(false);
    expect(health.mode).toBe("local-corpus");
    expect(health.missingSecrets).toEqual(["QDRANT_URL", "QDRANT_API_KEY"]);
    expect(JSON.stringify(health)).not.toContain("secret");
    expect(health.collection).toBe("industrial_collection");
  });

  it("reports ready state when required secrets are present", () => {
    const health = inspectHealth({
      QDRANT_URL: "https://qdrant.example",
      QDRANT_API_KEY: "q"
    });

    expect(health.ok).toBe(true);
    expect(health.providerReady).toBe(true);
    expect(health.mode).toBe("qdrant-inference");
    expect(health.missingSecrets).toEqual([]);
    expect(health.corpusCount).toBe(5);
  });

  it("reports anthropic-enhanced qdrant mode when Anthropic is also present", () => {
    const health = inspectHealth({
      ANTHROPIC_API_KEY: "a",
      QDRANT_URL: "https://qdrant.example",
      QDRANT_API_KEY: "q"
    });

    expect(health.mode).toBe("anthropic-qdrant");
  });
});

describe("live local corpus mode", () => {
  it("answers a query without provider secrets", async () => {
    const result = await queryRag({}, "What is the maximum RDS(on) for IPB017N10N5?");

    expect(result.mode).toBe("local-corpus");
    expect(result.answer).toContain("1.7 mOhm");
    expect(result.sources[0].partNumber).toBe("IPB017N10N5");
  });

  it("runs eval without provider secrets", async () => {
    const result = await runEval({});

    expect(result.total).toBe(10);
    expect(result.hitRate).toBeGreaterThanOrEqual(0.8);
    expect(result.top1Accuracy).toBeGreaterThanOrEqual(0.8);
  });
});

describe("retrieval ranking", () => {
  it("boosts exact part-number matches above semantically similar hits", () => {
    const retrievals: Retrieval[] = [
      {
        id: "neighbor",
        documentId: "neighbor",
        title: "Neighbor MOSFET",
        sourceUrl: "https://example.test/neighbor.pdf",
        partNumber: "IPB044N15N5",
        text: "IPB044N15N5 has typical RDS(on) of 4.4 mOhm.",
        chunkIndex: 0,
        score: 0.58
      },
      {
        id: "target",
        documentId: "target",
        title: "Target MOSFET",
        sourceUrl: "https://example.test/target.pdf",
        partNumber: "IPB017N10N5",
        text: "IPB017N10N5 has maximum RDS(on) of 1.7 mOhm.",
        chunkIndex: 0,
        score: 0.54
      }
    ];

    const [top] = rerankForDatasheetIdentifiers("What is the maximum RDS(on) for IPB017N10N5?", retrievals);

    expect(top.partNumber).toBe("IPB017N10N5");
  });
});

describe("api errors", () => {
  it("normalizes missing secret errors", () => {
    const error = toApiError(new Error("Missing QDRANT_API_KEY"));

    expect(error.code).toBe("missing_secret");
    expect(error.missingSecrets).toEqual(["QDRANT_API_KEY"]);
  });

  it("keeps explicit bad request errors", () => {
    const error = toApiError(badRequest("Expected JSON body with question"));

    expect(error.code).toBe("bad_request");
    expect(error.status).toBe(400);
  });

  it("builds multi-secret missing errors", () => {
    const error = missingSecretError(["QDRANT_API_KEY", "QDRANT_URL"]);

    expect(error.code).toBe("missing_secret");
    expect(error.message).toContain("QDRANT_API_KEY");
    expect(error.message).toContain("QDRANT_URL");
  });
});

describe("console questions", () => {
  it("exports five canned questions for the console", () => {
    expect(consoleQuestions).toHaveLength(5);
    expect(consoleQuestions.map((item) => item.expectedPartNumber)).toContain("IPB017N10N5");
  });
});
