import { Hono } from "hono";
import { corpus } from "../corpus/manifest";
import { consoleQuestions } from "../console/questions";
import { runEval } from "../eval/scoring";
import { ingestPdf, queryRag } from "../rag/pipeline";
import { badRequest } from "./errors";
import { inspectHealth } from "./health";
import type { Env } from "../types";

export const api = new Hono<{ Bindings: Env }>();

api.post("/ingest", async (c) => {
  const body = await c.req.json<{ pdfUrl?: string; documentId?: string }>().catch(() => null);
  if (!body?.pdfUrl) {
    throw badRequest("Expected JSON body with pdfUrl");
  }
  const result = await ingestPdf(c.env, { pdfUrl: body.pdfUrl, documentId: body.documentId });
  return c.json(result);
});

api.post("/ingest/corpus", async (c) => {
  const results = [];
  for (const doc of corpus) {
    results.push(await ingestPdf(c.env, { pdfUrl: doc.pdfUrl, documentId: doc.documentId }));
  }
  return c.json({ ingested: results.length, results });
});

api.post("/query", async (c) => {
  const body = await c.req.json<{ question?: string }>().catch(() => null);
  if (!body?.question) {
    throw badRequest("Expected JSON body with question");
  }
  const result = await queryRag(c.env, body.question);
  return c.json(result);
});

api.get("/eval", async (c) => {
  const result = await runEval(c.env);
  return c.json(result);
});

api.get("/health", (c) => {
  return c.json(inspectHealth(c.env));
});

api.get("/report", (c) => {
  const health = inspectHealth(c.env);
  return c.json({
    name: "Industrial Datasheet RAG",
    liveUrl: "https://industrial-doc-rag.mariusdeving.workers.dev",
    health,
    corpus: corpus.map((doc) => ({
      documentId: doc.documentId,
      title: doc.title,
      partNumber: doc.partNumber,
      sourceUrl: doc.sourceUrl
    })),
    questions: consoleQuestions,
    eval: health.ok ? { endpoint: "/eval", status: "ready" } : { endpoint: "/eval", status: "blocked", missingSecrets: health.missingSecrets }
  });
});
