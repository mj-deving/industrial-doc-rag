# Loom Script

Target length: 2-4 minutes.

1. Open the live Worker URL.
   - Say: "This is a Cloudflare Worker, not a notebook or FastAPI clone. Hono serves the operator console and the JSON API from the same edge deployment."
   - Point at the runtime status strip: the Worker is live on packaged corpus and will switch to provider-backed retrieval when secrets are set.

2. Ingest the packaged corpus if needed.
   - Click "Ingest corpus".
   - Say: "The ingest path accepts public PDF URLs. In provider-backed mode it embeds with Cohere and writes vectors to Qdrant; today the live public Worker is answering from the packaged corpus."

3. Ask a concrete datasheet question.
   - Click the IPB017N10N5 canned query.
   - Point out answer, confidence, top source, and score.

4. Ask a selection question.
   - Click the BSC027N04LS G canned query.
   - Point out that source inspection matters more than a polished chat answer.

5. Run eval.
   - Click "Run eval".
   - Say: "This is a small but explicit eval loop: ten ground-truth questions, hit rate, top-1 accuracy, and answer-term coverage. It is intentionally simple because the system needs an honest feedback loop, not benchmark theater."

6. Close with tradeoff.
   - Say: "The useful part is the substrate: Workers, Qdrant, source-grounded JSON, and eval output. The next real engineering step would be richer PDF extraction and table-aware chunking, not UI polish."
