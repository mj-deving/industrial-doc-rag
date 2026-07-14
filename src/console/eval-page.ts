// The public eval page, built against the shared mjdeving-lab design lock.
// Lock + tokens: MJ-OS references/design-system/lab/{reference-lock.md,design.md,tokens.css}
// Archetype A (console). Project accent: cyan #45c7e0 (measurement / instrument panel).
// Accent role = signal only: the eyebrow, the winning row, the bar fill. Never a wash.
// Mono role = numbers and technical metadata. Prose stays sans.
//
// Structure is a paper, not an essay: abstract, headline results, then figures, then
// method, then the defect log, then limits. A reader who stops after the first screen
// has the findings. Everything below the fold is support for them.
//
// This page RENDERS a committed results file. It does not run the eval. An eval that
// reran per page view would bill the visitor and report a slightly different number
// every time, which is the opposite of what a benchmark is for. The numbers below
// were produced by `bun tools/eval.ts` and `bun tools/scale.ts` against the deployed
// Worker and the real index, and they are checked into the repository next to the
// code that produced them.

import type { Results, Scale } from "./eval-data";

const pct = (n: number) => (n * 100).toFixed(1);
const num = (n: number) => n.toFixed(3);
const int = (n: number) => n.toLocaleString("en");

function ablationRows(results: Results): string {
  const label: Record<string, string> = {
    dense: "dense (vector only)",
    "dense+symbol": "dense + part rerank",
    "hybrid-rrf": "dense + part lookup, fused"
  };
  return Object.entries(results.retrieval)
    .map(([name, m]) => {
      const win = name === results.best ? ' class="win"' : "";
      return `<tr${win}>
        <td class="s">${label[name] ?? name}</td>
        <td>${num(m.recall[1])}</td>
        <td>${num(m.recall[5])}</td>
        <td>${num(m.recall[10])}</td>
        <td>${num(m.mrr)}</td>
      </tr>`;
    })
    .join("");
}

function dimensionRows(results: Results): string {
  const label: Record<string, string> = {
    vds: "V<sub>DS</sub> rating",
    rdson: "R<sub>DS(on)</sub> max, at stated conditions",
    id: "I<sub>D</sub> continuous",
    package: "Package"
  };
  return Object.entries(results.answer.byDimension)
    .map(
      ([key, d]) => `<tr>
        <td class="s">${label[key] ?? key}</td>
        <td>${d.n}</td>
        <td>${num(d.correct)}</td>
        <td class="barcell"><span class="bar"><i style="width:${pct(d.correct)}%"></i></span></td>
      </tr>`
    )
    .join("");
}

function scaleRows(scale: Scale): string {
  return scale.curve
    .map(
      (s) => `<tr>
        <td class="s">${s.documents}</td>
        <td>${int(s.chunks)}</td>
        <td>${num(s.denseRecallAt1)}</td>
        <td>${num(s.fusedRecallAt1)}</td>
        <td>${s.p50Ms} ms</td>
        <td>$${s.storageUsdPerMonth.toFixed(3)}</td>
      </tr>`
    )
    .join("");
}

/** The defect log. Each row is a bug the eval found and the test suite did not. */
const DEFECTS: [string, string][] = [
  [
    "Evidence was one chunk per document",
    "Retrieval ranked the datasheets perfectly, then handed the model one chunk of each. Document recall read 1.000 while accuracy read 0.353, and the model was right to refuse: the figure was not in the excerpt."
  ],
  [
    "The model was shown half of every chunk",
    "The chunker bounds a chunk at 1,800 characters and the prompt truncated the excerpt at 900. Two constants had to agree and nothing made them, so every table chunk lost its last rows."
  ],
  [
    "A concurrent prune deleted a third of the index",
    "It inferred where a document ended from whichever slice a request happened to hold, and removed 8,414 of 25,536 chunks at random. Nothing failed. The eval kept reporting 0.95."
  ],
  [
    "The label read the summary, the model read the source",
    "I<sub>D</sub> came from the datasheet's own Quick Reference extract, which quotes a 5-second pulse rating, and the package came off a marketing bullet. 121 of 680 labels were wrong, and the model was marked wrong for reading the authoritative table."
  ],
  [
    "Boilerplate was a third of every document",
    "A disclaimer on every page, a legal section running to the end. Asked which package PMN28UNE ships in, the model was handed ten chunks of liability language."
  ],
  [
    "A table row lost its symbol at a chunk boundary",
    "A datasheet names a parameter once and leaves the column blank beneath it. Cut between them, the second row is a number belonging to nothing."
  ]
];

function defectRows(): string {
  return DEFECTS.map(
    ([what, cost]) => `<tr>
      <td class="s">${what}</td>
      <td class="prose">${cost}</td>
    </tr>`
  ).join("");
}

export function renderEval(results: Results, scale: Scale): string {
  const c = results.corpus;
  const dense = results.retrieval["dense"];
  const big = scale.curve[scale.curve.length - 1];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>industrial-doc-rag / eval</title>
  <style>
:root{
  --canvas:#0a0b0d; --surface:#121417; --surface-2:#171a1e;
  --border:#23272d; --border-bright:#2e343b;
  --text:#e7e9ec; --text-muted:#9aa1a8; --text-dim:#656b72;
  --accent:#45c7e0; --accent-dim:#2b8ea3; --accent-faint:rgba(69,199,224,.12);
  --danger:#e5674c;
  --font-sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --font-mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
  --radius:8px; --radius-sm:6px; --maxw:820px;
  color-scheme:dark;
}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--text);font-family:var(--font-sans);
  font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 20px}

/* ── masthead ───────────────────────────────────────────── */
header{padding:34px 0 0}
.eyebrow{font-family:var(--font-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--accent)}
h1{font-size:25px;line-height:1.28;font-weight:600;letter-spacing:-.015em;margin:10px 0 0;
  text-wrap:balance}
code{font-family:var(--font-mono);font-size:12px;color:var(--text);background:var(--surface-2);
  border:1px solid var(--border);border-radius:4px;padding:1px 5px}
.byline{font-family:var(--font-mono);font-size:11.5px;color:var(--text-dim);margin-top:12px;
  padding-bottom:22px;border-bottom:1px solid var(--border)}
.byline a{color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border-bright)}
.byline .sep{color:var(--border-bright);padding:0 6px}

/* ── abstract ───────────────────────────────────────────── */
.abstract{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:18px 20px;margin-top:26px}
.abstract p{margin:8px 0 0;color:var(--text-muted);font-size:13.5px;max-width:none}
.lab{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--text-dim)}

/* ── headline results ───────────────────────────────────── */
.results{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
.fig{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:13px 15px 14px}
.fig .k{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--text-dim)}
.fig .v{font-family:var(--font-mono);font-size:27px;line-height:1.15;font-weight:600;color:var(--text);
  margin-top:6px;letter-spacing:-.02em}
.fig .v.warn{color:var(--danger)}
.fig .d{color:var(--text-muted);font-size:12px;line-height:1.45;margin-top:5px}

/* ── sections ───────────────────────────────────────────── */
section{margin-top:44px}
h2{font-size:16px;font-weight:600;margin:0 0 18px;letter-spacing:-.005em;
  padding-bottom:10px;border-bottom:1px solid var(--border)}
h2 .n{font-family:var(--font-mono);font-size:12px;color:var(--text-dim);margin-right:10px;font-weight:400}
h3{font-size:13.5px;font-weight:600;margin:30px 0 0;color:var(--text)}
h3:first-of-type{margin-top:0}
.cap{font-family:var(--font-mono);font-size:11px;color:var(--text-dim);margin:5px 0 12px;
  max-width:74ch;line-height:1.5}
p{color:var(--text-muted);font-size:13.5px;max-width:72ch}
.find{border-left:2px solid var(--border-bright);padding-left:13px;margin-top:16px}
strong{color:var(--text);font-weight:600}

/* ── tables ─────────────────────────────────────────────── */
table{width:100%;border-collapse:collapse;font-family:var(--font-mono);font-size:12.5px}
th{text-align:right;color:var(--text-dim);font-weight:400;font-size:10.5px;letter-spacing:.04em;
  text-transform:uppercase;padding:0 0 8px;border-bottom:1px solid var(--border);white-space:nowrap}
th:first-child,td:first-child{text-align:left}
td{text-align:right;color:var(--text-muted);padding:9px 0;border-bottom:1px solid var(--border);
  white-space:nowrap}
td.s{color:var(--text)}
tr.win td{color:var(--text)}
tr.win td.s{color:var(--accent)}
td.barcell{width:30%;padding-left:14px}
.bar{display:block;height:3px;background:var(--border);border-radius:2px;overflow:hidden}
.bar>i{display:block;height:100%;background:var(--accent);border-radius:2px}

/* the defect log carries prose, so it wraps and it is sans */
table.log td{vertical-align:top;padding:12px 0}
table.log td.s{width:32%;padding-right:24px;white-space:normal;line-height:1.45}
td.prose{font-family:var(--font-sans);font-size:13px;text-align:left;white-space:normal;
  line-height:1.5;color:var(--text-muted)}

/* ── method + limits ────────────────────────────────────── */
dl{margin:0;display:grid;grid-template-columns:150px 1fr;gap:14px 24px}
dt{font-family:var(--font-mono);font-size:11px;letter-spacing:.04em;text-transform:uppercase;
  color:var(--text-dim);padding-top:2px}
dd{margin:0;color:var(--text-muted);font-size:13.5px}
ul{margin:0;padding-left:18px;color:var(--text-muted);font-size:13.5px;max-width:72ch}
li{margin-bottom:8px}
li::marker{color:var(--text-dim)}

footer{margin:52px 0 44px;padding-top:18px;border-top:1px solid var(--border);
  color:var(--text-dim);font-size:11.5px;font-family:var(--font-mono);line-height:1.7}
footer a{color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border)}

@media (max-width:680px){
  h1{font-size:21px;max-width:none}
  .results{grid-template-columns:repeat(2,1fr)}
  dl{grid-template-columns:1fr;gap:4px 0}
  dd{margin-bottom:10px}
  td.barcell{display:none}
  table.log td.s{width:40%}
  .scroller{overflow-x:auto}
}
  </style>
</head>
<body>
<div class="wrap">

  <header>
    <div class="eyebrow">Evaluation report</div>
    <h1>Retrieval and answer quality on ${c.documents} near-identical MOSFET datasheets</h1>
    <div class="byline">
      industrial-doc-rag<span class="sep">/</span>${results.generatedAt.slice(0, 10)}<span class="sep">/</span>bge-m3<span class="sep">·</span>Vectorize<span class="sep">·</span>llama-3.3-70b<span class="sep">/</span><a href="https://github.com/mj-deving/industrial-doc-rag">source + results file</a>
    </div>
  </header>

  <div class="abstract">
    <div class="lab">Abstract</div>
    <p>${c.documents} MOSFET datasheets from one vendor are indexed and ${c.heldOut} are deliberately
    held out. ${int(c.questions)} questions are generated from the tables themselves. Every question
    names its part in full, and dense retrieval alone still ranks the right datasheet first only
    ${pct(dense.recall[1])}% of the time: part numbers are the tokens an embedding is worst at. Fused
    with a part-number lookup it reaches ${num(results.retrieval[results.best].recall[1])}, and answers
    are then correct on ${pct(results.answer.correct)}% of ${results.answer.sample} questions. Every
    gain came from the evidence. The generator never changed.</p>
  </div>

  <section style="margin-top:26px">
    <div class="results">
      <div class="fig">
        <div class="k">Dense recall@1</div>
        <div class="v">${num(dense.recall[1])}</div>
        <div class="d">Vector search alone, on ${int(dense.questions)} indexed questions.</div>
      </div>
      <div class="fig">
        <div class="k">Fused recall@1</div>
        <div class="v">${num(results.retrieval[results.best].recall[1])}</div>
        <div class="d">Vector search fused with a part-number lookup.</div>
      </div>
      <div class="fig">
        <div class="k">Answer accuracy</div>
        <div class="v">${pct(results.answer.correct)}%</div>
        <div class="d">${results.answer.sample} questions, value and unit, 1% tolerance.</div>
      </div>
      <div class="fig">
        <div class="k">Refusal, model alone</div>
        <div class="v">${pct(results.refusal.refused)}%</div>
        <div class="d">Held-out parts the model declined to answer unaided.</div>
      </div>
      <div class="fig">
        <div class="k">Refusal, as shipped</div>
        <div class="v">${pct(results.refusal.guarded.refused)}%</div>
        <div class="d">With the identifier guard on, costing ${pct(results.refusal.guarded.wronglyRefusedIndexed)}% of indexed parts.</div>
      </div>
      <div class="fig">
        <div class="k">Inventions that are correct</div>
        <div class="v warn">${pct(results.refusal.hallucinatedButCorrect)}%</div>
        <div class="d">Of the ${pct(results.refusal.hallucinated)}% it invents, unaided. See §1.4.</div>
      </div>
    </div>
  </section>

  <section>
    <h2><span class="n">1</span>Results</h2>

    <h3>1.1 Retrieval</h3>
    <div class="cap">Table 1 · Three strategies over the ${int(dense.questions)} questions whose
    datasheet is in the index. Same embeddings, same k, same questions.</div>
    <div class="scroller">
    <table>
      <thead><tr>
        <th>strategy</th><th>recall@1</th><th>recall@5</th><th>recall@10</th><th>MRR</th>
      </tr></thead>
      <tbody>${ablationRows(results)}</tbody>
    </table>
    </div>
    <p class="find"><strong>The 1.000 is a primary-key read, not a triumph.</strong> The fused arm
    queries the exact part the question names. The number worth reading is the ${num(dense.recall[1])}
    beside it, on questions that spell the document's name out in full. The middle row is the rerank
    most demos ship, and it stops at exactly dense's own recall@10: a rerank reorders what it was
    handed and cannot retrieve what never came back.</p>

    <h3>1.2 Corpus size</h3>
    <div class="cap">Table 2 · Three real Vectorize indices, same pipeline, each scored only on the
    questions it could answer. Latency is timed one request at a time from outside Cloudflare.</div>
    <div class="scroller">
    <table>
      <thead><tr>
        <th>datasheets</th><th>chunks</th><th>dense r@1</th><th>fused r@1</th><th>p50</th><th>storage/mo</th>
      </tr></thead>
      <tbody>${scaleRows(scale)}</tbody>
    </table>
    </div>
    <p class="find"><strong>Five documents is not a retrieval problem: the answer is one of five.</strong>
    Dense is the only column that moves. At ${c.documents} datasheets the distractors differ from the
    target in two digits of a part number, and recall@1 falls to ${num(big.denseRecallAt1)}. A key
    lookup is indifferent to how many neighbours it has, so the fused column is flat. So is latency,
    which is what an ANN index is built for.</p>

    <h3>1.3 Answers</h3>
    <div class="cap">Table 3 · ${results.answer.sample} questions, ${results.best} retrieval,
    temperature 0, graded on value and unit at 1% tolerance. R<sub>DS(on)</sub> varies by more than 2x
    with junction temperature, so every question carries the conditions its label was measured at.</div>
    <div class="scroller">
    <table>
      <thead><tr><th>question type</th><th>n</th><th>correct</th><th></th></tr></thead>
      <tbody>${dimensionRows(results)}</tbody>
    </table>
    </div>
    <p class="find"><strong>This column read 0.353, then 0.840, and every gain came from the evidence
    rather than the model.</strong> The generator never changed. Three models from three vendors scored
    within a point of each other, which is what happens when they all fail on the same missing rows.
    The defects are logged in &sect;3.</p>
    <p>One question in ${results.answer.sample} still fails. Asked for R<sub>DS(on)</sub> at
    T<sub>j</sub> = 25 &deg;C, the model answers from the 150 &deg;C row and restates the 25 &deg;C
    conditions back. It reports conditions it did not read, and it is left in the number.</p>

    <h3>1.4 Refusal</h3>
    <div class="cap">${c.heldOut} datasheets were fetched, parsed, and kept out of the index. Their
    parts are still asked about, and ${c.documents} nearly identical ones ARE indexed, so retrieval
    hands the model ten plausible tables for the wrong component every time.</div>
    <p class="find"><strong>${pct(results.refusal.hallucinatedButCorrect)}% of the model's inventions
    are correct, and that is the finding.</strong> PSMN1R0-30YLD is a 30 V part whose name says 30 V.
    Asked about a datasheet it has never seen, the model decodes the naming convention and is right. An
    answer that is correct and grounded in no document is the worst output this system can produce,
    because nothing distinguishes it from one that is.</p>
    <p>So the rule lives in code, not in the prompt. If a question names a part and no retrieved chunk
    came from it, the system refuses before generating. Fused retrieval finds the asked document at
    rank 1 in all ${int(dense.questions)} indexed questions, so a part missing from the results is
    missing from the corpus. The ${pct(results.refusal.refused)}% is reported rather than the guarded
    ${pct(results.refusal.guarded.refused)}%, because a guarded 100% restates the definition of the
    guard.</p>
  </section>

  <section>
    <h2><span class="n">2</span>Method</h2>
    <dl>
      <dt>Corpus</dt>
      <dd>709 datasheets from the vendor's asset host. ${c.documents} indexed, ${c.heldOut} held out.
      The split is <code>fnv1a(part) % 100 &lt; 28</code>, a pure function of the part number, so there
      is no split file to go stale.</dd>

      <dt>Questions</dt>
      <dd>Nobody wrote them. A parser reads each PDF and emits four labelled facts per part:
      V<sub>DS</sub>, maximum R<sub>DS(on)</sub> with its conditions, continuous I<sub>D</sub>, and the
      package. Each is parsed from the table that states it, never from the datasheet's own summary of
      that table.</dd>

      <dt>Independence</dt>
      <dd>The system under test never sees that parse. Label and answer come from different mechanisms,
      which is the only reason grading one against the other means anything.</dd>

      <dt>Determinism</dt>
      <dd>Three runs of the same code against the same index return the same score and the same failure
      set. The noise floor is zero, so a number that moves is a real one.</dd>

      <dt>This page</dt>
      <dd>Renders a committed results file. It does not run the eval: a benchmark that reran per page
      view would bill the visitor and report a different number each time.</dd>
    </dl>
  </section>

  <section>
    <h2><span class="n">3</span>Defects found</h2>
    <div class="cap">Six defects the eval surfaced and the test suite did not. Two were in the eval
    itself, and a broken label looks exactly like a broken model until you open the evidence.</div>
    <div class="scroller">
    <table class="log">
      <tbody>${defectRows()}</tbody>
    </table>
    </div>
  </section>

  <section>
    <h2><span class="n">4</span>Limits</h2>
    <ul>
      <li>Every question names one part and asks for one figure. No comparison across two datasheets,
      no question without a part number, no figure that appears only in a graph, no German.</li>
      <li>The guard assumes the question names the part. One that does not falls back to the model,
      which is the ${pct(results.refusal.refused)}%.</li>
      <li>With one relevant document per question, nDCG@k and MRR are strictly decreasing functions of
      the same rank. They are one measurement printed twice.</li>
      <li>Query cost is not reported. Vectorize bills queried and stored dimensions together and does
      not say how a single query is counted, so any figure would be a guess with a dollar sign in front
      of it.</li>
      <li>One vendor, one component family. A corpus of lookalikes is the hard case for retrieval and
      also a narrow one.</li>
    </ul>
  </section>

  <footer>
    ${c.documents} datasheets<span class="sep"> · </span>${int(big.chunks)} chunks<span class="sep"> · </span>bge-m3 1024d<span class="sep"> · </span>retrieve p50 ${results.latency.retrieveP50Ms} ms<span class="sep"> · </span>generate p50 ${results.latency.generateP50Ms} ms<br>
    <a href="/">console</a> · <a href="https://github.com/mj-deving/industrial-doc-rag">source and results file</a>
  </footer>

</div>
</body>
</html>`;
}
