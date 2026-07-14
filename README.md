# industrial-doc-rag

A document RAG engine, and a measurement of what it is worth on 497 near-identical MOSFET datasheets.

**Live:** <https://industrial-doc-rag.mariusdeving.workers.dev> · **Numbers:** [/eval](https://industrial-doc-rag.mariusdeving.workers.dev/eval) · **Stack:** Workers · Vectorize · bge-m3 · llama-3.3-70b

Five documents is not a retrieval problem: the answer is one of five. 497 lookalike datasheets are, because the distractors now differ from the target in two digits of a part number. The 2,718 questions below measure what that costs, and 248 more ask what happens when the question names no datasheet at all.

## What the numbers say

What ships:

| | |
|---|---|
| Right datasheet at rank 1 (1,987 indexed questions) | **1.000** |
| Answers correct (400 questions, 1% tolerance) | **0.995** |
| Held-out parts refused | **1.000** |
| Questions naming no part at all (248 set queries) | **0.863** |

What the eval found:

| | |
|---|---|
| Vector search alone, recall@1 | **0.643** |
| Same, plus a part-number rerank | 0.949 |
| Held-out parts refused, by the model alone | 0.960 |
| Of the answers it invents unaided, the share that are correct | **0.250** |
| Set queries answered by retrieval instead of a table | **0.012** |
| …of those it got wrong, the share where the winner was never retrieved | **0.683** |

Retrieval is solved, and it is solved by a key lookup fused into the vector query rather than by a better embedding. The finding is the 0.643 underneath it. On questions that spell the document's name out in full, vector search alone puts the right datasheet first only two times in three, because part numbers are exactly the tokens an embedding model is worst at and 497 lookalike datasheets sit almost on top of one another in that space. That 0.643 is the pipeline most RAG demos ship, measured on the same corpus and the same questions.

The two refusal numbers are the same system measured twice, and the gap between them is the point. See "Refusal is enforced in code".

## What corpus size costs

Three real indices, same questions, same pipeline. The dense column is the one that moves.

| datasheets | chunks | dense recall@1 | fused recall@1 | p50 |
|---|---|---|---|---|
| 5 | 262 | **1.000** | 1.000 | 605 ms |
| 100 | 5,133 | 0.733 | 1.000 | 542 ms |
| 497 | 25,536 | 0.643 | 1.000 | 598 ms |

At five datasheets vector search is perfect, and it is perfect for a boring reason: the answer is one of five. A five-document demo does not measure a weak version of this problem, it measures a different one that does not contain it.

Latency is flat, which is the expected result rather than an achievement: an approximate nearest-neighbour index is built so that query time barely tracks corpus size. Retrieval runs at a p50 of 598 ms and generation at 1,074 ms. Storage for all 497 is $0.008 a month.

## A question with no part number in it

"Which 40 V part has the lowest R<sub>DS(on)</sub>?" names no datasheet. There is no key to look up, and the answer is a property of all 497 documents rather than of any one of them. Ten retrieved chunks are ten documents.

248 such questions are generated from the same labels: superlatives and counts over the corpus. Both systems below answer the identical questions, with the same embeddings, the same k, the same generator and the same grader.

| system | accuracy | precision when it answered | the winner was retrieved |
|---|---|---|---|
| retrieval only | 0.012 | 0.068 | 0.364 |
| a table built at ingest | **0.863** | 0.863 | n/a |

**Retrieval does not answer this question badly; it cannot answer it.** Of the ones it got wrong, 68% were wrong about a datasheet that was never retrieved at all. The model states the mechanism itself when it guesses: asked how many parts ship in a given package, it answered *"all 9 parts are offered in a LFPAK package"*. It counted the evidence in front of it and called that the corpus. No prompt and no larger model fixes that, because the information was never in the context.

So the corpus is read into a table once, at ingest — by the same model, reading the same chunks the retriever returns, never the label parser. A superlative is then `ORDER BY` and a count is `COUNT`, over all 497 rather than over ten. A planner turns the question into a filter and never writes a number; a question the table cannot express is refused, not guessed. Every figure a user sees has been counted.

What is left is the reading, not the arithmetic: **93% of the remaining wrong superlatives are wrong because the winning part was never in the pool the query compared.** The query is a `for` loop over that pool and is exact by construction. A part is absent from a comparison when the model, reading its datasheet, recorded no row under the conditions the question asks about — PMPB10XNE carries only its `t <= 5 s` row, so it is missing from every continuous-current question it should win. I<sub>D</sub> extraction recall is 0.849 and that is the ceiling on this column.

An error rate a lookup would shrug off is fatal to a superlative: **a query for an extremum selects for the errors that make a value more extreme.** Reading the Min column instead of the Max moved BUK7S0R7-40H from 0.7 mΩ to 0.43 mΩ on 6% of rows, and handed it every lowest-R<sub>DS(on)</sub> question in its class.

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

Asked to hold that line on its own, the model invents an answer on 4.0% of held-out questions. How it invents them is the finding: **25% of its inventions are correct.** `PSMN1R0-30YLD` is a 30 V part with an R<sub>DS(on)</sub> near 1.0 mΩ, and its *name says so*. Asked about a datasheet it has never seen, the model decodes the naming convention and answers "30 V", confidently, and is right. An answer that is correct and grounded in no document is the worst output this system can produce, because nothing distinguishes it from one that is.

So the rule is not asked for in the prompt, it is enforced in code. If a question names a part and no retrieved chunk came from that part, the system refuses before it generates. Fused retrieval finds the asked document at rank 1 in all 1,987 indexed questions, so a part missing from the results is a part missing from the corpus. The guard costs nothing: over 400 indexed questions it wrongly refuses zero.

The eval deliberately keeps the harder number. It runs with the guard **off**, so the 0.960 above is what the model does alone. A guarded 1.000 is a restatement of the guard's definition, and printing it as a result would be theatre.

## The engine does not know what a datasheet is

`packages/doc-rag/` knows documents, chunks, an index it can filter by document id, and a `symbolsOf(query)` hook that pulls identifiers out of a question. A datasheet adapter looks for part numbers; a legal adapter would look for case numbers. An engine that knew what a datasheet was could cheat.

```
packages/doc-rag/   chunk · prepare · retrieve (3 strategies) · answer · grade · metrics
src/engine/         the Cloudflare binding: Vectorize, Workers AI, part-number symbols
src/api/            /query · /health · /harness/* (token-guarded) · catalog · planner
src/console/        the console, and the /eval page (renders a committed results file)
tools/              groundtruth · split · questions · ingest · eval · scale · evidence
                    extract-attributes · grade-attributes · audit-packages · eval-corpus
```

## What it got wrong

Ten defects the eval found and the test suite did not. Five were in the instrument rather than in the system: a broken label looks exactly like a broken model until you open the evidence.

**Evidence was one chunk per document.** The fused strategy ranked documents perfectly, then handed the generator a single chunk of each. A datasheet is about 50 chunks; V<sub>DS</sub> is on page one and R<sub>DS(on)</sub> is in a table several pages in. Document recall read 1.000 while answer accuracy read 0.353, and the model was right to refuse, because the figure genuinely was not in the excerpt it was given. The test fixture returned one chunk per document too, so the fake was simpler than the corpus and the suite stayed green.

**The model was shown half of every chunk.** The chunker bounds a chunk at 1,800 characters. The prompt truncated each excerpt at 900, a number picked to "stay inside a small model's window" and never measured against one. Two constants had to agree and nothing made them, so the last rows of every table chunk were cut, and the last rows of a limiting-values table are exactly the operating points a question distinguishes between. `PMPB14XP`'s answer sat at character 1,040 of a 1,057-character chunk. The model answered from the row above it and was marked wrong for reading the only row it had been left.

**The prune deleted a third of the index.** 25,536 chunks were upserted; 17,122 were present. The ingest client packs fixed-size requests out of a stream of chunks from different datasheets and sends them concurrently, so a long datasheet spans several requests. The server inferred "where does this document end" from the payload in front of it, so the request holding chunks 0 to 6 concluded the document ended at 6 and deleted everything above, which was the chunks a concurrent request had just written. Which one won depended on which response landed first.

Nothing failed. The eval kept reporting 0.95 against a corpus with 8,414 chunks missing at random, because an index that is missing data does not crash, it just answers slightly worse. It was found by opening one failing question and reading what the model had actually been shown.

**Boilerplate was a third of every document.** A disclaimer stamped on every page, and a legal section running to the end. Thirty of `PMN28UNE`'s seventy chunks were copyright notice. Asked which package it ships in, the model was handed ten chunks of liability language and refused, which was the only honest thing it could do.

**A table row loses its symbol at a chunk boundary.** A datasheet names a parameter once and leaves the column blank on the rows beneath it. Cut between them, the second row is a number belonging to nothing. Each row is now bound to its symbol before chunking, which also made the rows generic enough to retrieve each other's parts, so each chunk is prefixed with its part number on purpose. The part number used to reach every chunk by accident, in the copyright footer, and stripping the boilerplate removed the anchor along with the noise.

**Unicode has two ohm signs and this corpus uses both.** U+2126 OHM SIGN and U+03A9 GREEK CAPITAL OMEGA render identically and are not equal. The unit filter was a character class written to hold both of them, and it held U+03A9 twice, because you cannot tell them apart in an editor. Every datasheet encoding the sign the other way lost every R<sub>DS(on)</sub> row it had: 89 parts came back with no on-resistance label, so no on-resistance question, so they were never tested. The table window was also a fixed 8,000 characters from the anchor, and `PSMN1R3-30YL` prints its table 15,113 characters in, so the parser read a summary surface — the same defect, a fourth time. Coverage went from 591 of 680 to 680.

**The label held one measurement per part.** One measurement answers a question about one part. A comparison across condition classes needs every row, and `PSMNR58-30YLH` quotes R<sub>DS(on)</sub> at both 10 V and 4.5 V; the parser kept the 10 V row; so the truth for "lowest at VGS = 4.5 V" was computed over a pool that did not contain the part that *wins* it. The system answered 0.9 mΩ, correctly, and the eval marked it wrong. Fifth time the label was the broken side.

**The examples in a prompt became the answer.** To fix a package-name recall problem, the extraction prompt listed ten real package names as examples of the two naming conventions. Recall went from 0.786 to 0.959 — and a part whose ordering table was not retrieved came back with *eleven* packages, which is every name in that list. Measured against the PDF text itself, which is neither the model nor the label: the catalogue named a package the document never prints on 6 of 497 parts. An example in a prompt is a value the model can emit.

**Fixing one column error created another.** The extraction was reading the Min column of the R<sub>DS(on)</sub> row. Told to read Min/Typ/Max properly, the model started reading the em-dash in an *empty* Min cell as a minus sign, and 67 N-channel parts came back rated -60 V. The channel was inferred from that sign, so they did not become slightly wrong — they became P-channel parts, leaving every N-channel comparison and entering every P-channel one, and no answer would have looked odd. The channel is read from the datasheet's first sentence now: a field inferred from the sign of another field flips whenever that sign is misread.

**I<sub>D</sub> read as a condition, and it is fixed.** The symbol I<sub>D</sub> appears twice in a datasheet: once as the rated parameter, once as a test condition for R<sub>DS(on)</sub>. The model returned the condition. An earlier version of this README reported that as unfixed, at 0.64. It now scores 1.000 on 108 questions, because the fix was never a better prompt, it was showing the model the whole table.

Two indexed questions in 400 still fail. `PSMN5R3-25MLD` is asked for R<sub>DS(on)</sub> at VGS = 10 V and the model answers 8.49 mΩ, which is the 4.5 V row printed directly above it. `BUK9K22-80E` is refused outright although its datasheet was retrieved at rank 1.

The older failure, still there: `PSMN1R5-50YLH` is asked for R<sub>DS(on)</sub> at T<sub>j</sub> = 25 °C, the top excerpt holds the 150 °C row, and the model answers 3.52 mΩ while restating the 25 °C conditions from the question back at me. It reports conditions it did not read. That is left in the number rather than prompted away until the test goes green.

## Reproduce it

```bash
bun install
bun test                                              # 135 tests

bun tools/fetch.ts data/parts.txt corpus              # 709 PDFs from the vendor
bun tools/groundtruth.ts corpus > data/groundtruth.json
bun tools/questions.ts data/groundtruth.json > data/questions.json   # 2,718 questions, 680 parts
bun tools/questions-corpus.ts > data/questions-corpus.json           # 248 questions that name no part

INGEST_TOKEN=... bun tools/ingest.ts corpus <worker-url>
INGEST_TOKEN=... bun tools/eval.ts <worker-url> --sample 400         # data/eval-results.json
INGEST_TOKEN=... bun tools/scale.ts <worker-url> --ingest            # data/eval-scale.json
INGEST_TOKEN=... bun tools/evidence.ts <worker-url> <question-id>    # what the model was shown

INGEST_TOKEN=... bun tools/extract-attributes.ts <worker-url>        # the catalogue: 497 model calls
bun tools/grade-attributes.ts                                        # what the reading was worth
bun tools/audit-packages.ts                                          # a third mechanism: the PDF text itself
INGEST_TOKEN=... bun tools/eval-corpus.ts <worker-url>               # the set queries
INGEST_TOKEN=... bun tools/eval-corpus-baseline.ts <worker-url>      # the same questions, no catalogue
```

The index/holdout split is `fnv1a(part) % 100 < 28`, a pure function of the part number. There is no split file to go stale and no second copy to drift out of step.

`/eval` renders the committed results file. It does not run the eval. A benchmark that reran on every page view would bill the visitor and report a slightly different number each time.

Three consecutive runs of the same code against the same index return the same score and the same failures, so a moved number is a real one. An earlier version of this README blamed the platform's decoding for a one-question wobble. The wobble was an index that had not finished settling after a re-ingest.

## Limits

- The table holds four fields: V<sub>DS</sub>, R<sub>DS(on)</sub>, I<sub>D</sub>, package. A set query about anything else (gate charge, thermal resistance) is refused rather than answered from ten chunks, and the refusal says which four it does hold.
- I<sub>D</sub> extraction recall is 0.849, and it is the ceiling on the set-query column. A part whose current row was never read is absent from the comparison, and the query then returns the best of what is left — exactly, and wrongly.
- Package agreement reads 0.998, and it is agreement after both sides are normalised the same way. One of those normalisations, folding a SOT version suffix onto its base code, was adopted because the label does it. On that transform the two mechanisms are no longer independent and the number is worth less than it looks.
- Still nothing here tests a comparison across two named datasheets, a figure that only appears in a graph, or German.
- With one relevant document per question, nDCG@k and MRR are both strictly decreasing functions of the same rank. They are one measurement printed twice.
- Query cost is not reported. Vectorize's published formula bills queried and stored dimensions together and does not say plainly how a single query is counted, so any figure would be a guess with a dollar sign in front of it.
- The corpus is 497 indexed datasheets, not 1000: 758 candidate parts, 709 with a live PDF, 49 obsolete parts served as HTML instead.
- The PDFs are not in this repo and are not republished. Citations link to the vendor's own asset host.

## License

MIT
