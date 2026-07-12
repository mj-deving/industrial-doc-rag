// Console, built against the shared mjdeving-lab design lock.
// Lock + tokens: MJ-OS references/design-system/lab/{reference-lock.md,design.md,tokens.css}
// Archetype A (console). Project accent: cyan #45c7e0 (measurement / instrument panel).
// Accent role = signal only: the one action, the live badge, the score bar. Never a wash.
// Mono role = technical metadata only. Prose stays sans.
// UI language is English because the corpus and the embedding model are English-only;
// a German question would retrieve badly. Honesty beats consistency here.
export function renderConsole(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>industrial-doc-rag / datasheet console</title>
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

header{border-bottom:1px solid var(--border);padding:22px 0 18px;margin-bottom:32px}
.headrow{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap}
.mark{font-weight:700;font-size:19px;letter-spacing:-.01em}
.mark .dim{color:var(--text-dim);font-weight:400}
.tag{color:var(--text-muted);font-size:13.5px;margin-top:4px;max-width:62ch}
.stack{display:flex;gap:6px;flex-wrap:wrap}
.prim{font-family:var(--font-mono);font-size:11px;color:var(--text-dim);
  border:1px solid var(--border);border-radius:5px;padding:2px 7px;white-space:nowrap}

.health{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}
.badge{font-family:var(--font-mono);font-size:11px;color:var(--text-dim);
  border:1px solid var(--border);border-radius:5px;padding:2px 7px}
.badge.live{color:var(--accent);border-color:var(--accent-dim)}
.badge.off{color:var(--text-dim);border-color:var(--border)}

.field{display:flex;gap:10px;align-items:stretch}
#q{flex:1;min-width:0;background:var(--surface);color:var(--text);border:1px solid var(--border);
  border-radius:var(--radius);padding:14px 16px;font-family:var(--font-sans);font-size:15px;
  outline:none;transition:border-color .12s ease}
#q::placeholder{color:var(--text-dim)}
#q:focus{border-color:var(--accent)}
#ask{background:var(--accent);color:#04171c;border:0;border-radius:var(--radius);
  padding:0 20px;font-weight:600;font-size:14px;cursor:pointer;font-family:var(--font-sans);
  transition:background .12s ease;white-space:nowrap}
#ask:hover{background:#63d4e9}
#ask:disabled{background:var(--accent-dim);opacity:.55;cursor:not-allowed}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.chip{font-family:var(--font-mono);font-size:12px;color:var(--text-muted);background:transparent;
  border:1px solid var(--border);border-radius:var(--radius-sm);padding:5px 10px;cursor:pointer;
  transition:border-color .12s ease,color .12s ease}
.chip:hover{border-color:var(--border-bright);color:var(--text)}
.hint{margin-top:12px;color:var(--text-dim);font-size:12.5px}

.answer-region{margin-top:34px;min-height:4px}
.meta{display:flex;align-items:center;gap:10px;margin-bottom:10px;min-height:18px;flex-wrap:wrap}
#answer{font-size:15.5px;color:var(--text);white-space:pre-wrap;word-break:break-word}
#answer.noanswer{color:var(--danger)}

.cites{margin-top:24px;display:grid;gap:8px}
.cite{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:11px 13px}
.cite-top{display:flex;align-items:center;justify-content:space-between;gap:12px;
  font-family:var(--font-mono);font-size:12.5px}
.cite-src{color:var(--text)}
.cite-src a{color:var(--text);text-decoration:none;border-bottom:1px solid var(--border)}
.cite-idx{color:var(--text-dim)}
.bar{margin-top:8px;height:3px;background:var(--border);border-radius:2px;overflow:hidden}
.bar>i{display:block;height:100%;background:var(--accent);border-radius:2px}
.excerpt{color:var(--text-muted);font-size:13px;margin-top:8px}

.panel{margin-top:40px;border-top:1px solid var(--border);padding-top:18px}
.panel summary{cursor:pointer;color:var(--text-muted);font-size:13.5px;list-style:none;
  display:flex;align-items:center;gap:8px}
.panel summary::-webkit-details-marker{display:none}
.panel summary .n{font-family:var(--font-mono);color:var(--text-dim);font-size:12px}
.evalbar{display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap}
#run-eval{background:transparent;color:var(--text-muted);border:1px solid var(--border);
  border-radius:var(--radius-sm);padding:6px 12px;font-size:12px;font-family:var(--font-mono);
  cursor:pointer;transition:border-color .12s ease,color .12s ease}
#run-eval:hover{border-color:var(--border-bright);color:var(--text)}
#run-eval:disabled{opacity:.5;cursor:not-allowed}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.metric{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:11px 13px;font-family:var(--font-mono);font-size:12px;color:var(--text-dim)}
.metric b{display:block;font-size:20px;color:var(--text);font-weight:600;margin-top:4px}
.cases{margin-top:12px;display:grid;gap:1px;font-family:var(--font-mono);font-size:12.5px;
  max-height:280px;overflow:auto}
.case{display:flex;justify-content:space-between;gap:12px;padding:6px 2px;
  border-bottom:1px solid var(--border);color:var(--text-muted)}
.case .c{color:var(--text-dim)}
.case.miss .c{color:var(--danger)}
.err{color:var(--danger);font-family:var(--font-mono);font-size:12.5px}

footer{margin:48px 0 40px;color:var(--text-dim);font-size:12px;font-family:var(--font-mono)}
footer a{color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border)}

@media (max-width:520px){
  .metrics{grid-template-columns:1fr}
  .field{flex-direction:column}
  #ask{padding:12px 20px}
}
  </style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="headrow">
      <div>
        <div class="mark">industrial-doc-rag<span class="dim">/</span></div>
        <div class="tag">Questions about five public Infineon MOSFET datasheets, answered from the datasheet text. Every answer carries the source it came from.</div>
      </div>
      <div class="stack" aria-label="pipeline primitives">
        <span class="prim">Workers</span><span class="prim">Qdrant</span><span class="prim">Rerank</span>
        <span class="prim">Eval</span>
      </div>
    </div>
  </header>

  <div class="health" id="health"><span class="badge">reading health ...</span></div>

  <div class="console">
    <div class="field">
      <input id="q" type="text" autocomplete="off" value="What is the maximum RDS(on) for IPB017N10N5?">
      <button id="ask">Ask</button>
    </div>
    <div class="chips" id="chips"></div>
    <div class="hint">Retrieval is dense top-5 plus a part-number rerank. Answers are extracted from the datasheet, not generated.</div>
  </div>

  <div class="answer-region" id="region">
    <div class="meta" id="meta"></div>
    <div id="answer"></div>
    <div class="cites" id="cites"></div>
  </div>

  <details class="panel">
    <summary>Eval loop <span class="n" id="evalcount">10 ground-truth cases</span></summary>
    <div class="evalbar">
      <button id="run-eval">run eval</button>
      <span class="badge" id="evalnote">retrieval hit, top-1 part match, answer-term coverage</span>
    </div>
    <div class="metrics" id="metrics" hidden></div>
    <div class="cases" id="cases"></div>
  </details>

  <footer>
    edge-deployed datasheet RAG &middot; <a href="https://github.com/mj-deving/industrial-doc-rag" target="_blank" rel="noreferrer">github.com/mj-deving/industrial-doc-rag</a> &middot; <a href="/report" target="_blank" rel="noreferrer">evidence report</a>
  </footer>
</div>

<script>
  var healthEl = document.getElementById("health");
  var chipsEl = document.getElementById("chips");
  var metaEl = document.getElementById("meta");
  var answerEl = document.getElementById("answer");
  var citesEl = document.getElementById("cites");
  var metricsEl = document.getElementById("metrics");
  var casesEl = document.getElementById("cases");
  var qEl = document.getElementById("q");
  var askEl = document.getElementById("ask");
  var evalEl = document.getElementById("run-eval");

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c];
    });
  }

  function badge(label, live) {
    var b = document.createElement("span");
    b.className = "badge " + (live ? "live" : "off");
    b.textContent = label;
    return b;
  }

  function getJson(url) {
    return fetch(url).then(function (r) { return r.json(); });
  }

  function postJson(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function renderError(target, error) {
    target.innerHTML = "";
    var d = document.createElement("div");
    d.className = "err";
    d.textContent = (error.code || "error") + ": " + (error.message || JSON.stringify(error));
    target.appendChild(d);
  }

  getJson("/report").then(function (report) {
    var h = report.health;
    // Upstream reachability, not config presence. A dead Qdrant cluster leaves
    // the secrets set, so providerReady would still say "ready" while every
    // query degrades to the packaged corpus.
    var reachable = h.upstream && h.upstream.reachable;
    healthEl.innerHTML = "";
    healthEl.appendChild(badge(reachable ? "qdrant live" : "packaged corpus", reachable));
    healthEl.appendChild(badge(reachable ? h.mode : "local-corpus", true));
    healthEl.appendChild(badge("corpus " + h.corpusCount, true));
    if (!reachable && h.upstream) {
      healthEl.appendChild(badge(h.upstream.detail, false));
    }

    chipsEl.innerHTML = "";
    (report.questions || []).forEach(function (item) {
      var c = document.createElement("button");
      c.className = "chip";
      c.textContent = item.expectedPartNumber;
      c.title = item.question;
      c.addEventListener("click", function () {
        qEl.value = item.question;
        ask();
      });
      chipsEl.appendChild(c);
    });

    if (new URLSearchParams(location.search).get("proof") === "1") {
      ask();
      getJson("/eval").then(renderEval);
    }
  });

  function ask() {
    var question = qEl.value.trim();
    if (!question) return;
    askEl.disabled = true;
    metaEl.innerHTML = "";
    metaEl.appendChild(badge("querying ...", true));
    answerEl.className = "";
    answerEl.textContent = "";
    citesEl.innerHTML = "";

    postJson("/query", { question: question }).then(function (data) {
      askEl.disabled = false;
      if (data.error) {
        metaEl.innerHTML = "";
        renderError(answerEl, data.error);
        return;
      }
      metaEl.innerHTML = "";
      metaEl.appendChild(badge("confidence " + data.confidence, true));
      metaEl.appendChild(badge(data.mode || "unknown", false));
      answerEl.textContent = data.answer;

      citesEl.innerHTML = "";
      (data.sources || []).forEach(function (s) {
        var card = document.createElement("div");
        card.className = "cite";

        var top = document.createElement("div");
        top.className = "cite-top";
        var src = document.createElement("span");
        src.className = "cite-src";
        var a = document.createElement("a");
        a.href = s.sourceUrl;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = s.partNumber;
        src.appendChild(a);
        var idx = document.createElement("span");
        idx.className = "cite-idx";
        idx.textContent = Number(s.score).toFixed(3);
        top.appendChild(src);
        top.appendChild(idx);

        var bar = document.createElement("div");
        bar.className = "bar";
        var fill = document.createElement("i");
        fill.style.width = Math.max(2, Math.min(100, Number(s.score) * 100)) + "%";
        bar.appendChild(fill);

        var ex = document.createElement("div");
        ex.className = "excerpt";
        ex.textContent = s.excerpt;

        card.appendChild(top);
        card.appendChild(bar);
        card.appendChild(ex);
        citesEl.appendChild(card);
      });
    }).catch(function (e) {
      askEl.disabled = false;
      renderError(answerEl, { code: "network", message: String(e) });
    });
  }

  function renderEval(data) {
    evalEl.disabled = false;
    if (data.error) {
      renderError(casesEl, data.error);
      return;
    }
    metricsEl.hidden = false;
    metricsEl.innerHTML = "";
    [["hit rate", data.hitRate], ["top-1", data.top1Accuracy], ["answer terms", data.answerTermAccuracy]]
      .forEach(function (pair) {
        var m = document.createElement("div");
        m.className = "metric";
        m.textContent = pair[0];
        var b = document.createElement("b");
        b.textContent = Math.round(pair[1] * 100) + "%";
        m.appendChild(b);
        metricsEl.appendChild(m);
      });

    casesEl.innerHTML = "";
    (data.cases || []).forEach(function (item) {
      var hit = item.topPart === item.expectedPartNumber;
      var row = document.createElement("div");
      row.className = "case" + (hit ? "" : " miss");
      var left = document.createElement("span");
      left.textContent = item.expectedPartNumber;
      var right = document.createElement("span");
      right.className = "c";
      right.textContent = (item.topPart || "none") + " / " + item.confidence;
      row.appendChild(left);
      row.appendChild(right);
      casesEl.appendChild(row);
    });
  }

  askEl.addEventListener("click", ask);
  qEl.addEventListener("keydown", function (e) { if (e.key === "Enter") ask(); });
  evalEl.addEventListener("click", function () {
    evalEl.disabled = true;
    casesEl.innerHTML = "";
    metricsEl.hidden = true;
    getJson("/eval").then(renderEval).catch(function (e) {
      evalEl.disabled = false;
      renderError(casesEl, { code: "network", message: String(e) });
    });
  });
</script>
</body>
</html>`;
}
