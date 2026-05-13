import { describe, expect, it } from "bun:test";
import { badRequest, missingSecretError, toApiError } from "../src/api/errors";
import { inspectHealth } from "../src/api/health";
import { consoleQuestions } from "../src/console/questions";

describe("health", () => {
  it("reports missing secrets without exposing configured values", () => {
    const health = inspectHealth({
      ANTHROPIC_API_KEY: "secret",
      COHERE_API_KEY: "secret",
      QDRANT_COLLECTION: "industrial_collection"
    });

    expect(health.ok).toBe(false);
    expect(health.missingSecrets).toEqual(["QDRANT_URL", "QDRANT_API_KEY"]);
    expect(JSON.stringify(health)).not.toContain("secret");
    expect(health.collection).toBe("industrial_collection");
  });

  it("reports ready state when required secrets are present", () => {
    const health = inspectHealth({
      ANTHROPIC_API_KEY: "a",
      COHERE_API_KEY: "c",
      QDRANT_URL: "https://qdrant.example",
      QDRANT_API_KEY: "q"
    });

    expect(health.ok).toBe(true);
    expect(health.missingSecrets).toEqual([]);
    expect(health.corpusCount).toBe(5);
  });
});

describe("api errors", () => {
  it("normalizes missing secret errors", () => {
    const error = toApiError(new Error("Missing COHERE_API_KEY"));

    expect(error.code).toBe("missing_secret");
    expect(error.missingSecrets).toEqual(["COHERE_API_KEY"]);
  });

  it("keeps explicit bad request errors", () => {
    const error = toApiError(badRequest("Expected JSON body with question"));

    expect(error.code).toBe("bad_request");
    expect(error.status).toBe(400);
  });

  it("builds multi-secret missing errors", () => {
    const error = missingSecretError(["COHERE_API_KEY", "QDRANT_URL"]);

    expect(error.code).toBe("missing_secret");
    expect(error.message).toContain("COHERE_API_KEY");
    expect(error.message).toContain("QDRANT_URL");
  });
});

describe("console questions", () => {
  it("exports five canned questions for the console", () => {
    expect(consoleQuestions).toHaveLength(5);
    expect(consoleQuestions.map((item) => item.expectedPartNumber)).toContain("IPB017N10N5");
  });
});
