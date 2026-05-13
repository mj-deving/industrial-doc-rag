# Industrial Datasheet RAG

Source-grounded RAG for industrial datasheets: Cloudflare Workers, Hono, Qdrant, Cohere embeddings, and Anthropic generation.

The live Worker answers technical MOSFET datasheet questions with inspectable sources and a visible eval loop. It runs immediately on the packaged corpus and switches to provider-backed retrieval when Anthropic, Cohere, and Qdrant secrets are configured.

## Visual Proof

![Industrial Datasheet RAG console](docs/visual-proof.png)

## Architecture

- `POST /ingest` accepts a public PDF URL. With provider secrets it embeds chunks and stores vectors in Qdrant; without provider secrets it reports packaged-corpus readiness.
- `POST /query` uses Cohere/Qdrant/Anthropic when configured, otherwise it uses Worker-native retrieval over the packaged corpus and returns structured JSON with source cards.
- `GET /eval` runs ten ground-truth Q&A cases and reports hit rate, top-1 accuracy, and answer-term coverage.
- `GET /health` reports missing/configured runtime dependencies without leaking secret values.
- `GET /` and `GET /console` serve the operator console from the same Worker.

## Tradeoffs

- **Hono on Workers, not FastAPI:** the deployment target is the Worker itself. Workers remove server management and keep the route surface small enough to inspect in minutes.
- **Cohere embeddings:** Anthropic does not provide embedding models. Cohere `embed-v4.0` with 1024 dimensions gives a direct multilingual embedding path that works over plain HTTP from Workers.
- **Haiku-class generation:** the configured default is `claude-haiku-4-5-20251001` because the application needs low latency over retrieved snippets. The exact model remains an environment variable so an API-side model naming issue is visible instead of hidden in code.
- **Packaged-corpus fallback:** the public Worker must be live without waiting on third-party trial keys. When secrets are absent, retrieval runs in the Worker against the same curated corpus facts and returns source-grounded extractive answers.
- **Dense top-5 retrieval:** no reranker in v1. For a four-minute Loom, the source list must be easy to inspect and the failure mode must be obvious.
- **PDF extraction:** Workers cannot run the common Node PDF parser stack. The code first attempts a lightweight PDF text extraction. For the five known Infineon PDFs it falls back to curated datasheet chunks after validating that the PDF URL is reachable. That keeps `/ingest` honest enough for the current corpus while leaving table-aware PDF parsing as the correct next investment.
- **Eval loop:** ten fixed Q&A pairs are enough to prove whether retrieval is wired correctly. The metrics are not a benchmark claim; they are a regression tripwire.

## Setup

```bash
bun install
cp .dev.vars.example .dev.vars
```

Fill `.dev.vars`:

```bash
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
COHERE_API_KEY=...
QDRANT_URL=https://your-qdrant-cluster
QDRANT_API_KEY=...
QDRANT_COLLECTION=industrial_datasheets
```

Run locally:

```bash
bun run typecheck
bun test
bunx wrangler dev
```

Open the operator console:

```bash
open http://localhost:8787/
```

Check runtime status:

```bash
curl -s http://localhost:8787/health | jq
curl -s http://localhost:8787/report | jq
```

Ingest the packaged corpus:

```bash
curl -X POST http://localhost:8787/ingest/corpus
```

Query:

```bash
curl -s http://localhost:8787/query \
  -H 'content-type: application/json' \
  -d '{"question":"What is the maximum RDS(on) for IPB017N10N5?"}' | jq
```

Eval:

```bash
curl -s http://localhost:8787/eval | jq
```

Deploy:

```bash
bunx wrangler secret put ANTHROPIC_API_KEY
bunx wrangler secret put COHERE_API_KEY
bunx wrangler secret put QDRANT_URL
bunx wrangler secret put QDRANT_API_KEY
bunx wrangler secret put QDRANT_COLLECTION
bunx wrangler secret put ANTHROPIC_MODEL
bunx wrangler deploy
```

Live Worker URL:

```text
https://industrial-doc-rag.mariusdeving.workers.dev
```

## API

### `GET /health`

Response:

```json
{
  "ok": true,
  "providerReady": false,
  "mode": "local-corpus",
  "missingSecrets": ["COHERE_API_KEY"],
  "configured": {
    "anthropic": true,
    "cohere": false,
    "qdrantUrl": true,
    "qdrantApiKey": true,
    "localCorpus": true
  },
  "model": "claude-haiku-4-5-20251001",
  "collection": "industrial_datasheets",
  "corpusCount": 5
}
```

When provider-backed mode is active and an upstream secret is missing, failures use this stable shape:

```json
{
  "error": {
    "code": "missing_secret",
    "message": "Missing required secret: COHERE_API_KEY",
    "missingSecrets": ["COHERE_API_KEY"],
    "nextStep": "Set Worker secret COHERE_API_KEY and redeploy."
  }
}
```

### `POST /ingest`

```json
{
  "pdfUrl": "https://www.infineon.com/assets/row/public/documents/24/49/infineon-ipb017n10n5-datasheet-en.pdf?fileId=5546d4624a75e5f1014ac4a981111eed",
  "documentId": "ipb017n10n5"
}
```

Response:

```json
{
  "documentId": "ipb017n10n5",
  "chunks": 1,
  "sourceUrl": "https://..."
}
```

### `POST /query`

```json
{
  "question": "What is the maximum RDS(on) for IPB017N10N5?"
}
```

Response:

```json
{
  "answer": "...",
  "sources": [
    {
      "title": "...",
      "sourceUrl": "...",
      "partNumber": "IPB017N10N5",
      "score": 0.82,
      "excerpt": "..."
    }
  ],
  "confidence": "high",
  "retrievals": []
}
```

## Corpus

The packaged corpus uses five public Infineon MOSFET datasheets:

- IPB017N10N5
- IPT007N06N
- BSC010N04LS
- BSC027N04LS G
- IPB044N15N5

## Reference Integration

`n8n-template.json` shows the reference workflow:

```text
Webhook -> POST /query -> Slack notification + Email notification
```

Use `LOOM_SCRIPT.md` for the recording flow.
