// The public eval page, built against the shared mjdeving-lab design lock.
// Lock + tokens: MJ-OS references/design-system/lab/{reference-lock.md,design.md,tokens.css}
// Archetype A (console). Project accent: cyan #45c7e0 (measurement / instrument panel).
// Accent role = signal only: the winning row, the bar fill. Never a wash.
// Mono role = numbers and technical metadata. Prose stays sans.
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

function ablationRows(results: Results): string {
  const best = results.best;
  return Object.entries(results.retrieval)
    .map(([name, m]) => {
      const win = name === best ? ' class="win"' : "";
      return `<tr${win}>
        <td class="s">${name}</td>
        <td>${num(m.recall[1])}</td>
        <td>${num(m.recall[5])}</td>
        <td>${num(m.recall[10])}</td>
        <td>${num(m.mrr)}</td>
        <td>${num(m.ndcg[10])}</td>
      </tr>`;
    })
    .join("");
}

function dimensionRows(results: Results): string {
  const label: Record<string, string> = {
    vds: "V<sub>DS</sub> rating",
    rdson: "R<sub>DS(on)</sub> max",
    id: "I<sub>D</sub> continuous",
    package: "Package"
  };
  return Object.entries(results.answer.byDimension)
    .map(
      ([key, d]) => `<tr>
        <td class="s">${label[key] ?? key}</td>
        <td>${d.n}</td>
        <td>${pct(d.correct)}%</td>
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
        <td>${s.chunks.toLocaleString("en")}</td>
        <td>${num(s.denseRecallAt1)}</td>
        <td>${num(s.fusedRecallAt1)}</td>
        <td>${s.p50Ms} ms</td>
        <td>${s.p95Ms} ms</td>
        <td>$${s.storageUsdPerMonth.toFixed(3)}</td>
      </tr>`
    )
    .join("");
}

export function renderEval(results: Results, scale: Scale): string {
  const c = results.corpus;
  const dense = results.retrieval["dense"];
  const fused = results.retrieval[results.best];

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

header{border-bottom:1px solid var(--border);padding:22px 0 18px;margin-bottom:30px}
.headrow{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap}
.mark{font-weight:700;font-size:19px;letter-spacing:-.01em}
.mark .dim{color:var(--text-dim);font-weight:400}
.mark a{color:var(--text);text-decoration:none}
.tag{color:var(--text-muted);font-size:13.5px;margin-top:4px;max-width:64ch}
.stamp{font-family:var(--font-mono);font-size:11px;color:var(--text-dim)}

.strip{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:34px}
.stat{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:11px 13px;font-family:var(--font-mono);font-size:11.5px;color:var(--text-dim)}
.stat b{display:block;font-size:21px;color:var(--text);font-weight:600;margin-top:3px}

section{margin-bottom:40px}
h2{font-size:15px;font-weight:600;margin:0 0 4px;letter-spacing:-.005em}
.lede{color:var(--text-muted);font-size:13.5px;margin:0 0 16px;max-width:70ch}
p{color:var(--text-muted);font-size:13.5px;max-width:70ch}
p.note{border-left:2px solid var(--border-bright);padding-left:12px;margin-top:16px}
strong{color:var(--text);font-weight:600}

table{width:100%;border-collapse:collapse;font-family:var(--font-mono);font-size:12.5px}
th{text-align:right;color:var(--text-dim);font-weight:400;font-size:11px;padding:0 0 8px;
  border-bottom:1px solid var(--border);white-space:nowrap}
th:first-child,td:first-child{text-align:left}
td{text-align:right;color:var(--text-muted);padding:9px 0;border-bottom:1px solid var(--border);
  white-space:nowrap}
td.s{color:var(--text)}
tr.win td{color:var(--text)}
tr.win td.s{color:var(--accent)}
td.barcell{width:34%;padding-left:14px}
.bar{display:block;height:3px;background:var(--border);border-radius:2px;overflow:hidden}
.bar>i{display:block;height:100%;background:var(--accent);border-radius:2px}

.split{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px}
.card{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:13px 15px}
.card .k{font-family:var(--font-mono);font-size:11.5px;color:var(--text-dim)}
.card .v{font-family:var(--font-mono);font-size:24px;font-weight:600;color:var(--text);margin-top:2px}
.card .v.warn{color:var(--danger)}
.card .d{color:var(--text-muted);font-size:12.5px;margin-top:6px}

footer{margin:48px 0 40px;padding-top:18px;border-top:1px solid var(--border);
  color:var(--text-dim);font-size:12px;font-family:var(--font-mono)}
footer a{color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border)}

@media (max-width:640px){
  .strip{grid-template-columns:repeat(2,1fr)}
  .split{grid-template-columns:1fr}
  td.barcell{display:none}
  th:last-child{display:none}
}
  </style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="headrow">
      <div>
        <div class="mark"><a href="/">industrial-doc-rag</a><span class="dim">/eval</span></div>
        <div class="tag">What the system scores on ${c.questions.toLocaleString("en")} questions derived from the datasheets themselves, and what it still gets wrong.</div>
      </div>
      <div class="stamp">${results.generatedAt.slice(0, 10)}</div>
    </div>
  </header>

  <div class="strip">
    <div class="stat">datasheets indexed<b>${c.documents}</b></div>
    <div class="stat">held out<b>${c.heldOut}</b></div>
    <div class="stat">questions<b>${c.questions.toLocaleString("en")}</b></div>
    <div class="stat">chunks indexed<b>${scale.curve[scale.curve.length - 1].chunks.toLocaleString("en")}</b></div>
  </div>

  <section>
    <h2>Where the questions come from</h2>
    <p class="lede">Nobody wrote them. A parser reads the "Quick reference data" table out of each
    PDF and produces four labelled facts per part: the V<sub>DS</sub> rating, the maximum
    R<sub>DS(on)</sub> with the conditions it was measured at, the continuous I<sub>D</sub>, and the
    package. The question is generated from the label, so the label is not an opinion about the
    answer, it is the table the answer is printed in.</p>
    <p>The system under test never sees that parse. It embeds the whole document, retrieves across
    ${c.documents} near-identical MOSFET datasheets, and a model reads the excerpts it gets back. The
    label and the answer are produced by different mechanisms, which is the only reason grading one
    against the other means anything.</p>
  </section>

  <section>
    <h2>Retrieval, three strategies</h2>
    <p class="lede">Every question names its part number. The ablation asks what that identifier is
    worth. Scored over ${dense.questions.toLocaleString("en")} questions whose datasheet is in the index.</p>
    <table>
      <thead><tr>
        <th>strategy</th><th>recall@1</th><th>recall@5</th><th>recall@10</th><th>MRR</th><th>nDCG@10</th>
      </tr></thead>
      <tbody>${ablationRows(results)}</tbody>
    </table>

    <p class="note"><strong>The 1.000 is a lookup, not a triumph.</strong> The fused strategy runs a
    filtered query against the exact part the question names, so of course it finds it: that is a
    primary-key read on the key the corpus is filed under. It is reported because the honest number
    is the one next to it. <strong>Dense retrieval alone put the named datasheet at rank 1 in
    ${pct(dense.recall[1])}% of cases and failed to return it anywhere in the top 10 in
    ${pct(1 - dense.recall[10])}%</strong>, on questions that spell the document's name out in full.
    Part numbers are exactly the tokens an embedding model is worst at, and ${c.documents}
    lookalike datasheets sit almost on top of each other in that space.</p>

    <p>The middle row is the cheap fix most demos ship: rerank the dense results, float the named
    document up. It reaches ${num(results.retrieval["dense+symbol"].recall[1])} and stops there, at
    exactly dense's recall@10, because a rerank can only reorder what it was handed. It cannot
    retrieve a document that never came back. The gap between the middle and bottom rows is that
    distinction, measured.</p>
  </section>

  <section>
    <h2>Answers</h2>
    <p class="lede">Retrieval finding the document is not the same as the model answering from it.
    ${results.answer.sample} questions, ${results.best}, temperature 0, graded on the number and unit
    with a 1% tolerance.</p>
    <table>
      <thead><tr><th>question type</th><th>n</th><th>correct</th><th></th></tr></thead>
      <tbody>${dimensionRows(results)}</tbody>
    </table>
    <div class="split">
      <div class="card">
        <div class="k">correct</div>
        <div class="v">${pct(results.answer.correct)}%</div>
        <div class="d">Right value, right unit, within tolerance.</div>
      </div>
      <div class="card">
        <div class="k">wrong value</div>
        <div class="v${results.answer.wrongValue > 0.1 ? " warn" : ""}">${pct(results.answer.wrongValue)}%</div>
        <div class="d">Answered with a figure the datasheet does not carry at that condition.</div>
      </div>
    </div>

    <p class="note"><strong>I<sub>D</sub> is the weak column, and the reason is worth naming.</strong>
    In a datasheet the symbol I<sub>D</sub> appears twice: once as the parameter being rated, and
    once as a test condition for a different parameter. The PMV20XNE is rated
    <span style="font-family:var(--font-mono)">I<sub>D</sub> = 7.2 A</span>, and its R<sub>DS(on)</sub>
    row is measured <span style="font-family:var(--font-mono)">at I<sub>D</sub> = 5.7 A</span>. The
    model returns 5.7 A. It is reading a condition as if it were a rating. That is a real defect of
    this system, it is left in the number, and it is not fixed by rewriting the prompt until the test
    goes green.</p>
  </section>

  <section>
    <h2>Refusal</h2>
    <p class="lede">${c.heldOut} datasheets were fetched, parsed, and then deliberately kept out of
    the index. Their part numbers still get asked about. The trap is that ${c.documents} nearly
    identical datasheets ARE indexed, so retrieval hands the model ten plausible tables for the
    wrong components every single time.</p>
    <div class="split">
      <div class="card">
        <div class="k">refused correctly</div>
        <div class="v">${pct(results.refusal.refused)}%</div>
        <div class="d">Said the part is not in the corpus, rather than reading a neighbour's table.</div>
      </div>
      <div class="card">
        <div class="k">invented an answer</div>
        <div class="v${results.refusal.hallucinated > 0.05 ? " warn" : ""}">${pct(results.refusal.hallucinated)}%</div>
        <div class="d">Of those, ${pct(results.refusal.hallucinatedButCorrect)}% happened to be right, which would be worse.</div>
      </div>
    </div>
    <p class="note">Refusal here is a property of retrieval, not a promise in a prompt. The symbol arm
    queries the index for the named part; an unindexed part comes back empty, and there is nothing to
    answer from. A held-out part like BUK9V13-40H sits one letter from BUK9K13-40H, which IS indexed,
    and dense retrieval returns it first, with a complete and entirely wrong table.</p>
  </section>

  <section>
    <h2>Scale</h2>
    <p class="lede">Three real indices, built from the same datasheets, scored on the questions each
    one could actually answer. Latency is timed one request at a time from outside Cloudflare, so it
    includes the network. Storage is Vectorize's published rate on stored dimensions.</p>
    <table>
      <thead><tr>
        <th>datasheets</th><th>chunks</th><th>dense r@1</th><th>fused r@1</th>
        <th>p50</th><th>p95</th><th>storage/mo</th>
      </tr></thead>
      <tbody>${scaleRows(scale)}</tbody>
    </table>

    <p class="note"><strong>The dense column is the one that moves.</strong> Five datasheets is not a
    retrieval problem: the answer is one of five and the vector model gets it every time. At
    ${c.documents} the distractors are documents that differ from the target in two digits of a part
    number, which is precisely the token an embedding is worst at, and dense recall@1 falls to
    ${num(scale.curve[scale.curve.length - 1].denseRecallAt1)}. The fused column does not move,
    because a key lookup is indifferent to how many neighbours it has. That is the whole argument for
    building one.</p>

    <p>Latency is flat, and that is the expected result rather than an achievement: an approximate
    nearest-neighbour index is built so that query time barely tracks corpus size. Reporting it flat
    is more honest than dressing it up. Query cost is not on this table at all: Vectorize's published
    formula bills queried and stored dimensions together and does not say plainly how a single query
    is counted, so any figure here would be a guess with a dollar sign in front of it.</p>
  </section>

  <section>
    <h2>What this does not measure</h2>
    <p>Every question names exactly one part and asks for one figure. Nothing here tests a comparison
    across two datasheets, a question with no part number in it, a figure that only appears in a
    graph, or German. With one relevant document per question, nDCG@k and MRR are both strictly
    decreasing functions of the same rank: they are one measurement printed twice, and reporting both
    is convention, not evidence.</p>
  </section>

  <footer>
    ${c.documents} datasheets · ${scale.curve[scale.curve.length - 1].chunks.toLocaleString("en")} chunks · bge-m3 1024d · Vectorize · llama-3.3-70b ·
    <a href="https://github.com/mj-deving/industrial-doc-rag">source and results file</a>
  </footer>
</div>
</body>
</html>`;
}
