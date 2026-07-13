// Console, built against the shared mjdeving-lab design lock.
// Lock + tokens: MJ-OS references/design-system/lab/{reference-lock.md,design.md,tokens.css}
// Archetype A (console). Project accent: cyan #45c7e0 (measurement / instrument panel).
// Accent role = signal only: the one action, the live badge, the score bar. Never a wash.
// Mono role = technical metadata only. Prose stays sans.
// UI language is English because the corpus and the embedding model are English-only;
// a German question would retrieve badly. Honesty beats consistency here.
//
// v2: the copy no longer describes five Infineon datasheets and a Qdrant collection.
// It describes what is actually deployed, and it links the numbers to /eval rather
// than asserting them here.
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
.tag{color:var(--text-muted);font-size:13.5px;margin-top:4px;max-width:64ch}
.stack{display:flex;gap:6px;flex-wrap:wrap}
.prim{font-family:var(--font-mono);font-size:11px;color:var(--text-dim);
  border:1px solid var(--border);border-radius:5px;padding:2px 7px;white-space:nowrap}

.health{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}
.badge{font-family:var(--font-mono);font-size:11px;color:var(--text-dim);
  border:1px solid var(--border);border-radius:5px;padding:2px 7px}
.badge.live{color:var(--accent);border-color:var(--accent-dim)}
.badge.off{color:var(--danger);border-color:var(--danger)}

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
  transition:border-color .12s ease,color .12s ease;text-align:left}
.chip:hover{border-color:var(--border-bright);color:var(--text)}
.chip.held{color:var(--text-dim)}
.chip.held:hover{border-color:var(--danger);color:var(--danger)}
.hint{margin-top:12px;color:var(--text-dim);font-size:12.5px;max-width:70ch}
.hint a{color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border)}

.answer-region{margin-top:34px;min-height:4px}
.meta{display:flex;align-items:center;gap:10px;margin-bottom:10px;min-height:18px;flex-wrap:wrap}
#answer{font-size:15.5px;color:var(--text);white-space:pre-wrap;word-break:break-word}
#answer.refused{color:var(--danger)}

.cites{margin-top:24px;display:grid;gap:8px}
.cite{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:11px 13px}
.cite-top{display:flex;align-items:center;justify-content:space-between;gap:12px;
  font-family:var(--font-mono);font-size:12.5px}
.cite-src a{color:var(--text);text-decoration:none;border-bottom:1px solid var(--border)}
.cite-idx{color:var(--text-dim)}
.err{color:var(--danger);font-family:var(--font-mono);font-size:12.5px;margin-top:16px}

footer{margin:48px 0 40px;padding-top:18px;border-top:1px solid var(--border);
  color:var(--text-dim);font-size:12px;font-family:var(--font-mono)}
footer a{color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border)}

@media (max-width:520px){
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
        <div class="tag">Questions about 497 public Nexperia MOSFET datasheets, answered from the datasheet text. Every answer carries the source it came from, and parts that are not in the corpus get refused rather than approximated.</div>
      </div>
      <div class="stack" aria-label="pipeline primitives">
        <span class="prim">Workers</span><span class="prim">Vectorize</span><span class="prim">bge-m3</span>
        <span class="prim">RRF</span>
      </div>
    </div>
  </header>

  <div class="health" id="health"><span class="badge">reading index ...</span></div>

  <div class="console">
    <div class="field">
      <input id="q" type="text" autocomplete="off" value="What is the maximum RDS(on) of the PSMN011-100YSF at VGS = 10 V; ID = 20 A; Tj = 25 °C?">
      <button id="ask">Ask</button>
    </div>
    <div class="chips" id="chips"></div>
    <div class="hint">Retrieval fuses a dense vector search with a part-number lookup. The last question names a datasheet that was deliberately held out of the index, and a near-identical part is in it. <a href="/eval">See what it scores</a>.</div>
  </div>

  <div class="answer-region" id="region">
    <div class="meta" id="meta"></div>
    <div id="answer"></div>
    <div class="cites" id="cites"></div>
  </div>

  <footer>
    497 datasheets indexed &middot; 183 held out &middot; <a href="/eval">eval</a> &middot;
    <a href="https://github.com/mj-deving/industrial-doc-rag" target="_blank" rel="noreferrer">github.com/mj-deving/industrial-doc-rag</a>
  </footer>
</div>

<script>
  var healthEl = document.getElementById("health");
  var chipsEl = document.getElementById("chips");
  var metaEl = document.getElementById("meta");
  var answerEl = document.getElementById("answer");
  var citesEl = document.getElementById("cites");
  var qEl = document.getElementById("q");
  var askEl = document.getElementById("ask");

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c];
    });
  }

  function badge(label, cls) {
    var b = document.createElement("span");
    b.className = "badge " + (cls || "");
    b.textContent = label;
    return b;
  }

  fetch("/health").then(function (r) { return r.json(); }).then(function (h) {
    healthEl.innerHTML = "";
    healthEl.appendChild(badge(h.vectors.toLocaleString("en") + " vectors", "live"));
    healthEl.appendChild(badge(h.dimensions + "d " + h.embeddingModel.split("/").pop()));
    healthEl.appendChild(badge(h.strategy));
  }).catch(function () {
    healthEl.innerHTML = "";
    healthEl.appendChild(badge("index unreachable", "off"));
  });

  fetch("/questions").then(function (r) { return r.json(); }).then(function (list) {
    list.forEach(function (item) {
      var b = document.createElement("button");
      b.className = "chip" + (item.heldOut ? " held" : "");
      b.textContent = item.part + (item.heldOut ? " (held out)" : "");
      b.title = item.question;
      b.addEventListener("click", function () {
        qEl.value = item.question;
        ask();
      });
      chipsEl.appendChild(b);
    });
  });

  function ask() {
    var question = qEl.value.trim();
    if (!question) return;

    askEl.disabled = true;
    metaEl.innerHTML = "";
    metaEl.appendChild(badge("retrieving ..."));
    answerEl.className = "";
    answerEl.textContent = "";
    citesEl.innerHTML = "";

    fetch("/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: question })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        askEl.disabled = false;
        metaEl.innerHTML = "";

        if (res.error) {
          answerEl.className = "refused";
          answerEl.textContent = res.error;
          return;
        }

        metaEl.appendChild(badge(res.strategy));
        metaEl.appendChild(badge(res.timings.retrieveMs + "ms retrieve"));
        metaEl.appendChild(badge(res.timings.generateMs + "ms generate"));

        if (res.refused) {
          answerEl.className = "refused";
          answerEl.textContent =
            "Not in the corpus. This datasheet was held out of the index, and the parts that look like it are not substitutes.";
          return;
        }

        answerEl.textContent = res.answer;
        res.sources.forEach(function (source, i) {
          var el = document.createElement("div");
          el.className = "cite";
          el.innerHTML =
            '<div class="cite-top"><span class="cite-src"><a href="' +
            esc(source.sourceUrl) +
            '" target="_blank" rel="noreferrer">' +
            esc(source.part) +
            '.pdf</a></span><span class="cite-idx">rank ' +
            (i + 1) +
            "</span></div>";
          citesEl.appendChild(el);
        });
      })
      .catch(function (error) {
        askEl.disabled = false;
        metaEl.innerHTML = "";
        answerEl.className = "refused";
        answerEl.textContent = String(error);
      });
  }

  askEl.addEventListener("click", ask);
  qEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") ask();
  });
</script>
</body>
</html>`;
}
