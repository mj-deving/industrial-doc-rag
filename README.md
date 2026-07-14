# industrial-doc-rag

A document RAG engine, and a measurement of what it is worth on 497 near-identical MOSFET datasheets.

**Live:** <https://industrial-doc-rag.mariusdeving.workers.dev> · **Numbers:** [/eval](https://industrial-doc-rag.mariusdeving.workers.dev/eval) · **Stack:** Workers · Vectorize · bge-m3 · llama-3.3-70b

Five documents is not a retrieval problem: the answer is one of five. 497 lookalike datasheets are, because the distractors now differ from the target in two digits of a part number. The 2,629 questions below measure what that costs.

## What the numbers say

What ships:

| | |
|---|---|
| Right datasheet at rank 1 (1,918 indexed questions) | **1.000** |
| Answers correct (400 questions, 1% tolerance) | **0.998** |
| Held-out parts refused | **1.000** |

What the eval found:

| | |
|---|---|
| Vector search alone, recall@1 | **0.654** |
| Same, plus a part-number rerank | 0.952 |
| Held-out parts refused, by the model alone | 0.958 |
| Of the answers it invents unaided, the share that are correct | **0.412** |

Retrieval is solved, and it is solved by a key lookup fused into the vector query rather than by a better embedding. The finding is the 0.654 underneath it. On questions that spell the document's name out in full, vector search alone puts the right datasheet first only two times in three, because part numbers are exactly the tokens an embedding model is worst at and 497 lookalike datasheets sit almost on top of one another in that space. That 0.654 is the pipeline most RAG demos ship, measured on the same corpus and the same questions.

The two refusal numbers are the same system measured twice, and the gap between them is the point. See "Refusal is enforced in code".

## What corpus size costs

Three real indices, same questions, same pipeline. The dense column is the one that moves.

| datasheets | chunks | dense recall@1 | fused recall@1 | p50 |
|---|---|---|---|---|
| 5 | 262 | **1.000** | 1.000 | 489 ms |
| 100 | 5,133 | 0.732 | 1.000 | 488 ms |
| 497 | 25,536 | 0.654 | 1.000 | 487 ms |

At five datasheets vector search is perfect, and it is perfect for a boring reason: the answer is one of five. A five-document demo does not measure a weak version of this problem, it measures a different one that does not contain it.

Latency is flat, which is the expected result rather than an achievement: an approximate nearest-neighbour index is built so that query time barely tracks corpus size. Retrieval runs at a p50 of 452 ms and generation at 1,074 ms. Storage for all 497 is $0.008 a month.

## Where the questions come from

Nobody wrote them. A deterministic parser reads each PDF and emits four labelled facts per part: the V<sub>DS</sub> rating, the maximum R<sub>DS(on)</sub> with the conditions it was measured at, the continuous I<sub>D</sub>, and the package. The question is generated from the label.

Each fact is parsed from the table that states it. That sentence is doing more work than it looks like it is doing, because three separate times the parser read a fact off a *summary* surface instead, and each time it marked a correct answer wrong:

- The Limiting Values table lists two value columns and the Quick Reference table lists three. The row parser demanded three, so it had never matched a single Limiting Values row, and every I<sub>D</sub> label came from the datasheet's own extract of that table. 121 of 680 were wrong.
- A datasheet lists I<sub>D</sub> several times, at 25 °C, at 100 °C, and with a `t <= 5 s` duration limit. The label took whichever row was printed first, which is the 5-second rating. It is not the current the part can carry continuously.
- The package label was scanned out of the first 4,000 characters against a hand-written list of package names. `PSMN012-100YS` came out as `SO8`, read off a marketing bullet: *"LFPAK provides maximum power density in a Power SO8 package"*. Its title, its ordering table, and the model all say LFPAK. And 165 parts whose package was not on the list got no label, and therefore no question, so the benchmark was not testing them at all.

The system under test never sees that parse. It embeds the document, retrieves across 497 lookalikes, and a model reads the excerpts it gets back. Label and answer are produced by different mechanisms, which is the only reason grading one against the other means anything. That independence is also what makes a broken label look exactly like a broken model, which is why all three of the above cost a day before anything was actually wrong with the system.

R<sub>DS(on)</sub> varies by more than 2x with junction temperature. An unconditioned R<sub>DS(on)</sub> question is ill-posed, so every label carries the conditions it was measured at and every question repeats them.

## Refusal is enforced in code

183 datasheets were fetched, parsed, and then deliberately kept out of the index. Their part numbers still get asked about, and 497 nearly identical ones ARE indexed, so retrieval hands the model ten plausible tables for the wrong components every time.

Asked to hold that line on its own, the model invents an answer on 4.3% of held-out questions. How it invents them is the finding: **41% of its inventions are correct.** `PSMN1R0-30YLD` is a 30 V part with an R<sub>DS(on)</sub> near 1.0 mΩ, and its *name says so*. Asked about a datasheet it has never seen, the model decodes the naming convention and answers "30 V", confidently, and is right. An answer that is correct and grounded in no document is the worst output this system can produce, because nothing distinguishes it from one that is.

So the rule is not asked for in the prompt, it is enforced in code. If a question names a part and no retrieved chunk came from that part, the system refuses before it generates. Fused retrieval finds the asked document at rank 1 in all 1,918 indexed questions, so a part missing from the results is a part missing from the corpus. The guard costs nothing: over 400 indexed questions it wrongly refuses zero.

The eval deliberately keeps the harder number. It runs with the guard **off**, so the 0.958 above is what the model does alone. A guarded 1.000 is a restatement of the guard's definition, and printing it as a result would be theatre.

## The engine does not know what a datasheet is

`packages/doc-rag/` knows documents, chunks, an index it can filter by document id, and a `symbolsOf(query)` hook that pulls identifiers out of a question. A datasheet adapter looks for part numbers; a legal adapter would look for case numbers. An engine that knew what a datasheet was could cheat.

```
packages/doc-rag/   chunk · prepare · retrieve (3 strategies) · answer · grade · metrics
src/engine/         the Cloudflare binding: Vectorize, Workers AI, part-number symbols
src/api/            /query · /health · /harness/* (token-guarded)
src/console/        the console, and the /eval page (renders a committed results file)
tools/              groundtruth · split · questions · ingest · eval · scale · evidence
```

## What it got wrong

Six defects the eval found and the test suite did not. Two of them were in the eval, and two were mine.

**Evidence was one chunk per document.** The fused strategy ranked documents perfectly, then handed the generator a single chunk of each. A datasheet is about 50 chunks; V<sub>DS</sub> is on page one and R<sub>DS(on)</sub> is in a table several pages in. Document recall read 1.000 while answer accuracy read 0.353, and the model was right to refuse, because the figure genuinely was not in the excerpt it was given. The test fixture returned one chunk per document too, so the fake was simpler than the corpus and the suite stayed green.

**The model was shown half of every chunk.** The chunker bounds a chunk at 1,800 characters. The prompt truncated each excerpt at 900, a number picked to "stay inside a small model's window" and never measured against one. Two constants had to agree and nothing made them, so the last rows of every table chunk were cut, and the last rows of a limiting-values table are exactly the operating points a question distinguishes between. `PMPB14XP`'s answer sat at character 1,040 of a 1,057-character chunk. The model answered from the row above it and was marked wrong for reading the only row it had been left.

**The prune deleted a third of the index.** 25,536 chunks were upserted; 17,122 were present. The ingest client packs fixed-size requests out of a stream of chunks from different datasheets and sends them concurrently, so a long datasheet spans several requests. The server inferred "where does this document end" from the payload in front of it, so the request holding chunks 0 to 6 concluded the document ended at 6 and deleted everything above, which was the chunks a concurrent request had just written. Which one won depended on which response landed first.

Nothing failed. The eval kept reporting 0.95 against a corpus with 8,414 chunks missing at random, because an index that is missing data does not crash, it just answers slightly worse. It was found by opening one failing question and reading what the model had actually been shown.

**Boilerplate was a third of every document.** A disclaimer stamped on every page, and a legal section running to the end. Thirty of `PMN28UNE`'s seventy chunks were copyright notice. Asked which package it ships in, the model was handed ten chunks of liability language and refused, which was the only honest thing it could do.

**A table row loses its symbol at a chunk boundary.** A datasheet names a parameter once and leaves the column blank on the rows beneath it. Cut between them, the second row is a number belonging to nothing. Each row is now bound to its symbol before chunking, which also made the rows generic enough to retrieve each other's parts, so each chunk is prefixed with its part number on purpose. The part number used to reach every chunk by accident, in the copyright footer, and stripping the boilerplate removed the anchor along with the noise.

**I<sub>D</sub> read as a condition, and it is fixed.** The symbol I<sub>D</sub> appears twice in a datasheet: once as the rated parameter, once as a test condition for R<sub>DS(on)</sub>. The model returned the condition. An earlier version of this README reported that as unfixed, at 0.64. It now scores 1.000 on 108 questions, because the fix was never a better prompt, it was showing the model the whole table.

One indexed question in 400 still fails. `PSMN1R5-50YLH` is asked for R<sub>DS(on)</sub> at T<sub>j</sub> = 25 °C, the top excerpt holds the 150 °C row, and the model answers 3.52 mΩ while restating the 25 °C conditions from the question back at me. It reports conditions it did not read. That is left in the number rather than prompted away until the test goes green.

## Reproduce it

```bash
bun install
bun test                                              # 70 tests

bun tools/fetch.ts data/parts.txt corpus              # 709 PDFs from the vendor
bun tools/groundtruth.ts corpus > data/groundtruth.json
bun tools/questions.ts data/groundtruth.json > data/questions.json   # 2,629 questions, 680 parts

INGEST_TOKEN=... bun tools/ingest.ts corpus <worker-url>
INGEST_TOKEN=... bun tools/eval.ts <worker-url> --sample 400         # data/eval-results.json
INGEST_TOKEN=... bun tools/scale.ts <worker-url> --ingest            # data/eval-scale.json
INGEST_TOKEN=... bun tools/evidence.ts <worker-url> <question-id>    # what the model was shown
```

The index/holdout split is `fnv1a(part) % 100 < 28`, a pure function of the part number. There is no split file to go stale and no second copy to drift out of step.

`/eval` renders the committed results file. It does not run the eval. A benchmark that reran on every page view would bill the visitor and report a slightly different number each time.

Three consecutive runs of the same code against the same index return the same score and the same failures, so a moved number is a real one. An earlier version of this README blamed the platform's decoding for a one-question wobble. The wobble was an index that had not finished settling after a re-ingest.

## Limits

- Every question names one part and asks for one figure. Nothing here tests a comparison across two datasheets, a question with no part number in it, a figure that only appears in a graph, or German.
- The identifier guard assumes the question names the part. A question that does not ("which 40 V MOSFET has the lowest R<sub>DS(on)</sub>?") falls back to the model's own judgment, which is the 0.958.
- With one relevant document per question, nDCG@k and MRR are both strictly decreasing functions of the same rank. They are one measurement printed twice.
- Query cost is not reported. Vectorize's published formula bills queried and stored dimensions together and does not say plainly how a single query is counted, so any figure would be a guess with a dollar sign in front of it.
- The corpus is 497 indexed datasheets, not 1000: 758 candidate parts, 709 with a live PDF, 49 obsolete parts served as HTML instead.
- The PDFs are not in this repo and are not republished. Citations link to the vendor's own asset host.

## License

MIT
