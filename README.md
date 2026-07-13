# industrial-doc-rag

A document RAG engine, and a measurement of what it is worth on 497 near-identical MOSFET datasheets.

**Live:** <https://industrial-doc-rag.mariusdeving.workers.dev> · **Numbers:** [/eval](https://industrial-doc-rag.mariusdeving.workers.dev/eval) · **Stack:** Workers · Vectorize · bge-m3 · llama-3.3-70b

Five documents is not a retrieval problem: the answer is one of five. 497 lookalike datasheets are, because the distractors now differ from the target in two digits of a part number. The 2,510 questions below measure what that costs.

## What the numbers say

| | |
|---|---|
| Dense retrieval alone, recall@1 | **0.495** |
| Same, plus a part-number rerank | 0.794 |
| Same, fused with a part-number lookup | 1.000 |
| Answers correct (150 questions, 1% tolerance) | **0.840** |
| Held-out parts correctly refused (150 questions) | **0.973** |
| Held-out parts answered anyway | 0.027 |

The 1.000 is a primary-key lookup, not a triumph, and [/eval](https://industrial-doc-rag.mariusdeving.workers.dev/eval) says so. The number worth reading is the 0.495. On questions that spell the document's name out in full, vector search alone puts the right datasheet first in half of cases and fails to return it at all in one in five. Part numbers are exactly the tokens an embedding model is worst at, and 497 lookalike datasheets sit almost on top of one another in that space.

## Where the questions come from

Nobody wrote them. A deterministic parser reads the "Quick reference data" table out of each PDF and emits four labelled facts per part: the V<sub>DS</sub> rating, the maximum R<sub>DS(on)</sub> with the conditions it was measured at, the continuous I<sub>D</sub>, and the package. The question is generated from the label.

The system under test never sees that parse. It embeds the document, retrieves across 497 lookalikes, and a model reads the excerpts it gets back. Label and answer are produced by different mechanisms, which is the only reason grading one against the other means anything.

R<sub>DS(on)</sub> varies by more than 2x with junction temperature. An unconditioned R<sub>DS(on)</sub> question is ill-posed, so every label carries the conditions it was measured at and every question repeats them.

## Refusal is a property of retrieval

183 datasheets were fetched, parsed, and then deliberately kept out of the index. Their part numbers still get asked about, and 497 nearly identical ones ARE indexed, so retrieval hands the model ten plausible tables for the wrong components every time. `BUK9V13-40H` is held out. `BUK9K13-40H` is not, and dense retrieval returns it first, with a complete and entirely wrong table.

The symbol arm queries the index for the exact part named. An unindexed part comes back empty, and there is nothing to answer from. This is not a promise made in a prompt.

## The engine does not know what a datasheet is

`packages/doc-rag/` knows documents, chunks, an index it can filter by document id, and a `symbolsOf(query)` hook that pulls identifiers out of a question. A datasheet adapter looks for part numbers; a legal adapter would look for case numbers. An engine that knew what a datasheet was could cheat.

```
packages/doc-rag/   chunk · retrieve (3 strategies) · answer · grade · metrics
src/engine/         the Cloudflare binding: Vectorize, Workers AI, part-number symbols
src/api/            /query · /health · /harness/* (token-guarded)
src/console/        the console, and the /eval page (renders a committed results file)
tools/              groundtruth · split · questions · ingest · eval · scale
```

## What it got wrong

Two defects the eval found and the test suite did not.

**Evidence was one chunk per document.** The fused strategy ranked documents perfectly, then handed the generator a single chunk of each. A datasheet is about 74 chunks; V<sub>DS</sub> is on page one and R<sub>DS(on)</sub> is in a table several pages in. Document recall read 1.000 while answer accuracy read 0.353, and the model was right to refuse, because the figure genuinely was not in the excerpt it was given. It refused 53% of questions it should have answered. The test fixture returned one chunk per document too, so the fake was simpler than the corpus and the suite stayed green.

| | before | after |
|---|---|---|
| correct | 0.353 | **0.840** |
| refused wrongly | 0.533 | 0.053 |
| R<sub>DS(on)</sub> | 0.111 | **0.944** |
| V<sub>DS</sub> | 0.541 | 0.892 |

The pre-fix run is committed as `data/eval-results-before-fix.json`, measured against the old code on a preview deployment rather than quoted from memory. Reproduce it: `git checkout 7b71e9f -- packages/doc-rag/src/retrieve.ts`, redeploy, rerun.

**The benchmark's noise floor is about one question.** That before-number first came out 0.360 and reproduced at 0.353: same questions, same code, same `temperature: 0`, one answer of 150 different. Decoding on this platform is not bit-exact, so a gap of under a point is noise, not a result.

**I<sub>D</sub> gets read as a condition.** The symbol I<sub>D</sub> appears twice in a datasheet: once as the rated parameter, once as a test condition for R<sub>DS(on)</sub>. The PMV20XNE is rated I<sub>D</sub> = 7.2 A, and its R<sub>DS(on)</sub> row is measured at I<sub>D</sub> = 5.7 A. The model returns 5.7 A. This is still broken. It is why I<sub>D</sub> scores 0.64 against 0.94 for R<sub>DS(on)</sub>, and it is left in the number rather than prompted away until the test goes green.

## Reproduce it

```bash
bun install
bun test                                              # 37 tests

bun tools/fetch.ts data/parts.txt corpus              # 709 PDFs from the vendor
bun tools/groundtruth.ts corpus > data/groundtruth.json
bun tools/questions.ts > data/questions.json          # 2,510 questions over 680 parts

INGEST_TOKEN=... bun tools/ingest.ts corpus <worker-url>
INGEST_TOKEN=... bun tools/eval.ts <worker-url>       # writes data/eval-results.json
INGEST_TOKEN=... bun tools/scale.ts <worker-url>      # writes data/eval-scale.json
```

The index/holdout split is `fnv1a(part) % 100 < 28`, a pure function of the part number. There is no split file to go stale and no second copy to drift out of step.

`/eval` renders the committed results file. It does not run the eval. A benchmark that reran on every page view would bill the visitor and report a slightly different number each time.

## Limits

- Every question names one part and asks for one figure. Nothing here tests a comparison across two datasheets, a question with no part number in it, a figure that only appears in a graph, or German.
- With one relevant document per question, nDCG@k and MRR are both strictly decreasing functions of the same rank. They are one measurement printed twice.
- Query cost is not reported. Vectorize's published formula bills queried and stored dimensions together and does not say plainly how a single query is counted, so any figure would be a guess with a dollar sign in front of it.
- The corpus is 497 indexed datasheets, not 1000: 758 candidate parts, 709 with a live PDF, 49 obsolete parts served as HTML instead.
- The PDFs are not in this repo and are not republished. Citations link to the vendor's own asset host.

## License

MIT
