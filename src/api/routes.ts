import { Hono } from "hono";
import { corpus } from "../corpus/manifest";
import { runEval } from "../eval/scoring";
import { ingestPdf, queryRag } from "../rag/pipeline";
import type { Env } from "../types";

export const api = new Hono<{ Bindings: Env }>();

api.post("/ingest", async (c) => {
  const body = await c.req.json<{ pdfUrl?: string; documentId?: string }>().catch(() => null);
  if (!body?.pdfUrl) {
    return c.json({ error: "Expected JSON body with pdfUrl" }, 400);
  }
  const result = await ingestPdf(c.env, { pdfUrl: body.pdfUrl, documentId: body.documentId });
  return c.json(result);
});

api.post("/ingest/demo", async (c) => {
  const results = [];
  for (const doc of corpus) {
    results.push(await ingestPdf(c.env, { pdfUrl: doc.pdfUrl, documentId: doc.documentId }));
  }
  return c.json({ ingested: results.length, results });
});

api.post("/query", async (c) => {
  const body = await c.req.json<{ question?: string }>().catch(() => null);
  if (!body?.question) {
    return c.json({ error: "Expected JSON body with question" }, 400);
  }
  const result = await queryRag(c.env, body.question);
  return c.json(result);
});

api.get("/eval", async (c) => {
  const result = await runEval(c.env);
  return c.json(result);
});
