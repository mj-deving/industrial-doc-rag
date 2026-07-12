import { Hono } from "hono";
import { corpus } from "../corpus/manifest";
import { consoleQuestions } from "../console/questions";
import { runEval } from "../eval/scoring";
import { ingestPackagedCorpus, ingestPdf, queryRag } from "../rag/pipeline";
import { badRequest } from "./errors";
import { inspectHealth, probeUpstream } from "./health";
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
  const result = await ingestPackagedCorpus(c.env);
  return c.json({ ingested: corpus.length, result });
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

api.get("/health", async (c) => {
  const health = inspectHealth(c.env);
  const upstream = await probeUpstream(c.env);
  return c.json({
    ...health,
    upstream,
    // The mode the next query will actually run in, not the one the config implies.
    effectiveMode: upstream.reachable ? health.mode : "local-corpus"
  });
});

api.get("/report", async (c) => {
  const health = { ...inspectHealth(c.env), upstream: await probeUpstream(c.env) };
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
    eval: { endpoint: "/eval", status: "ready", mode: health.mode }
  });
});
