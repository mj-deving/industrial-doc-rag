# Industrial Datasheet RAG

Source-grounded RAG for industrial datasheets: Cloudflare Workers, Hono, Qdrant Cloud Inference, and optional Anthropic generation.

The live Worker answers technical MOSFET datasheet questions with inspectable sources and a visible eval loop. Production retrieval uses Qdrant Cloud Inference when Qdrant secrets are configured; the packaged corpus keeps local and public fallback behavior usable.

## Visual Proof

![Industrial Datasheet RAG console](docs/visual-proof.png)

## Architecture

- `POST /ingest` accepts a public PDF URL. With Qdrant secrets it stores chunks using Qdrant Cloud Inference; without Qdrant secrets it reports packaged-corpus readiness.
- `POST /query` uses Qdrant Cloud Inference when configured, otherwise it uses Worker-native retrieval over the packaged corpus and returns structured JSON with source cards.
- `GET /eval` runs ten ground-truth Q&A cases and reports hit rate, top-1 accuracy, and answer-term coverage.
- `GET /health` reports missing/configured runtime dependencies without leaking secret values.
- `GET /` and `GET /console` serve the operator console from the same Worker.

## Tradeoffs

- **Hono on Workers, not FastAPI:** the deployment target is the Worker itself. Workers remove server management and keep the route surface small enough to inspect in minutes.
- **Qdrant Cloud Inference:** Qdrant generates embeddings during upsert and query using `sentence-transformers/all-minilm-l6-v2`, so no separate embedding provider key is needed.
- **Optional Haiku-class generation:** if `ANTHROPIC_API_KEY` is configured, the Worker uses `claude-haiku-4-5-20251001` over retrieved snippets. Without Anthropic, it returns extractive source-grounded answers.
- **Packaged-corpus fallback:** the public Worker must be live without waiting on third-party trial keys. When secrets are absent, retrieval runs in the Worker against the same curated corpus facts and returns source-grounded extractive answers.
- **Dense top-5 plus identifier rerank:** Qdrant supplies semantic recall. A narrow part-number boost handles the industrial reality that exact component IDs should beat semantically similar neighbors.
- **PDF extraction:** Workers cannot run the common Node PDF parser stack. The code first attempts a lightweight PDF text extraction. For the five known Infineon PDFs it falls back to curated datasheet chunks after validating that the PDF URL is reachable. That keeps `/ingest` honest enough for the current corpus while leaving table-aware PDF parsing as the correct next investment.
- **Eval loop:** ten fixed Q&A pairs are enough to prove whether retrieval is wired correctly. The metrics are not a benchmark claim; they are a regression tripwire.

## Setup

```bash
bun install
cp .dev.vars.example .dev.vars
```

Fill `.dev.vars`:

```bash
ANTHROPIC_API_KEY=... # optional
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
QDRANT_URL=https://your-qdrant-cluster
QDRANT_API_KEY=...
QDRANT_COLLECTION=industrial_datasheets
QDRANT_INFERENCE_MODEL=sentence-transformers/all-minilm-l6-v2
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
bunx wrangler secret put QDRANT_URL
bunx wrangler secret put QDRANT_API_KEY
bunx wrangler secret put QDRANT_COLLECTION
bunx wrangler secret put QDRANT_INFERENCE_MODEL
bunx wrangler secret put ANTHROPIC_API_KEY # optional
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
  "missingSecrets": ["QDRANT_API_KEY"],
  "configured": {
    "anthropic": true,
    "qdrantUrl": true,
    "qdrantApiKey": true,
    "localCorpus": true
  },
  "model": "claude-haiku-4-5-20251001",
  "inferenceModel": "sentence-transformers/all-minilm-l6-v2",
  "collection": "industrial_datasheets",
  "corpusCount": 5
}
```

When a required secret is missing, failures use this stable shape:

```json
{
  "error": {
    "code": "missing_secret",
    "message": "Missing required secret: QDRANT_API_KEY",
    "missingSecrets": ["QDRANT_API_KEY"],
    "nextStep": "Set Worker secret QDRANT_API_KEY and redeploy."
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
