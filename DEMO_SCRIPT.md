# Loom Demo Script

Target length: 2-4 minutes.

1. Open the live Worker URL.
   - Say: "This is a Cloudflare Worker, not a notebook or FastAPI clone. Hono serves the UI and the JSON API from the same edge deployment."

2. Ingest the demo corpus if needed.
   - Run: `curl -X POST "$LIVE_URL/ingest/demo"`
   - Say: "The ingest path accepts public PDF URLs, validates the fetch, chunks technical datasheet content, embeds with Cohere, and writes vectors to Qdrant."

3. Ask a concrete datasheet question.
   - Use: "What is the maximum RDS(on) for IPB017N10N5?"
   - Point out answer, confidence, top source, and score.

4. Ask a selection question.
   - Use: "Which part is not recommended for new designs?"
   - Point out that source inspection matters more than a polished chat answer.

5. Run eval.
   - Open: `$LIVE_URL/eval`
   - Say: "This is a small but explicit eval loop: ten ground-truth questions, hit rate, top-1 accuracy, and answer-term coverage. It is intentionally simple because the demo needs an honest feedback loop, not benchmark theater."

6. Close with tradeoff.
   - Say: "The useful part is the substrate: Workers, Qdrant, source-grounded JSON, and eval output. The next real engineering step would be richer PDF extraction and table-aware chunking, not UI polish."
