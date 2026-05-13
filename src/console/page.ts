export function renderConsole(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Industrial Datasheet RAG Console</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f5f7fb; color: #172033; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f7fb; color: #172033; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 20px 44px; }
    header { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 18px; }
    h1 { font-size: 30px; line-height: 1.15; margin: 0 0 6px; }
    h2 { font-size: 17px; margin: 0 0 12px; }
    p { color: #526173; margin: 0; }
    a { color: #205cc8; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr); gap: 16px; }
    .panel { background: white; border: 1px solid #dce4ee; border-radius: 8px; padding: 16px; min-width: 0; }
    .status { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .pill { border: 1px solid #cdd7e5; border-radius: 999px; padding: 6px 10px; font-size: 13px; background: #f9fbfd; color: #27364a; }
    .pill.ok { border-color: #8fc6a2; background: #edf8f1; color: #176334; }
    .pill.blocked { border-color: #e2a5a5; background: #fff2f2; color: #9b1c1c; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0; }
    button { min-height: 40px; padding: 0 14px; border: 0; border-radius: 6px; background: #205cc8; color: white; font-weight: 650; cursor: pointer; }
    button.secondary { background: #34465f; }
    button.ghost { background: #edf1f7; color: #27364a; border: 1px solid #cdd7e5; }
    button:disabled { opacity: 0.6; cursor: progress; }
    form { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr) auto; margin: 12px 0; }
    input { min-height: 42px; width: 100%; padding: 0 12px; border: 1px solid #c8d0dc; border-radius: 6px; font-size: 15px; background: white; color: #172033; }
    pre { margin: 0; overflow: auto; white-space: pre-wrap; word-break: break-word; }
    .answer { min-height: 120px; }
    .sources, .cases { display: grid; gap: 10px; margin-top: 12px; }
    .source, .case { border: 1px solid #dce4ee; border-radius: 8px; padding: 12px; background: #fbfcfe; }
    .meta { color: #526173; font-size: 13px; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 12px 0; }
    .metric { border: 1px solid #dce4ee; border-radius: 8px; padding: 12px; background: #fbfcfe; }
    .metric strong { display: block; font-size: 24px; margin-top: 4px; }
    .error { color: #9b1c1c; }
    @media (max-width: 860px) {
      header, .grid { display: block; }
      .panel { margin-bottom: 14px; }
      form { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: 1fr; }
    }
    @media (prefers-color-scheme: dark) {
      :root, body { background: #0d1117; color: #e6edf3; }
      p, .meta { color: #9fb0c3; }
      .panel { background: #151b23; border-color: #303b4a; }
      .source, .case, .metric { background: #101720; border-color: #303b4a; }
      input { background: #0d1117; color: #e6edf3; border-color: #303b4a; }
      button.ghost { background: #182231; color: #e6edf3; border-color: #303b4a; }
      .pill { background: #101720; color: #d7e1ec; border-color: #303b4a; }
      .pill.ok { background: #0f2c1a; color: #9ee3b2; border-color: #2e8c4b; }
      .pill.blocked { background: #341616; color: #ffb8b8; border-color: #8a3030; }
      a { color: #80adff; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Industrial Datasheet RAG Console</h1>
        <p>Cloudflare Worker over Infineon MOSFET datasheets with source cards, provider-ready retrieval, and a small eval loop.</p>
      </div>
      <a href="/report" target="_blank" rel="noreferrer">Evidence report</a>
    </header>

    <section class="panel">
      <h2>Runtime Status</h2>
      <div id="status" class="status"><span class="pill">Loading health...</span></div>
      <div class="actions">
        <button id="ingest">Ingest corpus</button>
        <button id="eval" class="secondary">Run eval</button>
      </div>
      <p class="meta" id="status-detail"></p>
    </section>

    <div class="grid">
      <section class="panel">
        <h2>Ask A Datasheet Question</h2>
        <div id="questions" class="actions"></div>
        <form id="query-form">
          <input id="question" name="question" value="What is the maximum RDS(on) for IPB017N10N5?" autocomplete="off">
          <button type="submit">Query</button>
        </form>
        <div class="panel answer" id="answer">No query yet.</div>
        <div class="sources" id="sources"></div>
      </section>

      <section class="panel">
        <h2>Eval Loop</h2>
        <p class="meta">Ten ground-truth checks: retrieval hit, top-1 part match, and answer-term coverage.</p>
        <div class="metrics" id="metrics"></div>
        <div class="cases" id="cases"></div>
      </section>
    </div>
  </main>
  <script>
    const state = { report: null };
    const statusEl = document.querySelector("#status");
    const detailEl = document.querySelector("#status-detail");
    const questionsEl = document.querySelector("#questions");
    const answerEl = document.querySelector("#answer");
    const sourcesEl = document.querySelector("#sources");
    const metricsEl = document.querySelector("#metrics");
    const casesEl = document.querySelector("#cases");
    const form = document.querySelector("#query-form");
    const questionInput = document.querySelector("#question");
    const ingestButton = document.querySelector("#ingest");
    const evalButton = document.querySelector("#eval");

    loadReport().then(() => {
      if (new URLSearchParams(location.search).get("proof") === "1") {
        query(questionInput.value);
        getJson("/eval").then(renderEval);
      }
    });

    ingestButton.addEventListener("click", async () => {
      await runAction(ingestButton, async () => {
        answerEl.textContent = "Ingesting five datasheets...";
        const data = await postJson("/ingest/corpus", {});
        if (data.error) {
          renderError(answerEl, data.error);
          sourcesEl.innerHTML = "";
          return;
        }
        answerEl.innerHTML = "<strong>Ingest complete</strong><pre>" + escapeHtml(JSON.stringify(data, null, 2)) + "</pre>";
        sourcesEl.innerHTML = "";
      });
    });

    evalButton.addEventListener("click", async () => {
      await runAction(evalButton, async () => {
        metricsEl.innerHTML = '<div class="metric">Running eval...</div>';
        const data = await getJson("/eval");
        renderEval(data);
      });
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await query(questionInput.value);
    });

    async function loadReport() {
      const report = await getJson("/report");
      state.report = report;
      renderHealth(report.health);
      renderQuestions(report.questions);
    }

    function renderHealth(health) {
      const items = [
        [health.mode === "provider-backed" ? "Provider-backed" : "Packaged corpus", true],
        ["Anthropic", health.configured.anthropic],
        ["Cohere", health.configured.cohere],
        ["Qdrant URL", health.configured.qdrantUrl],
        ["Qdrant key", health.configured.qdrantApiKey],
        ["Corpus " + health.corpusCount, true],
        [health.collection, true]
      ];
      statusEl.innerHTML = items.map(([label, ok]) => '<span class="pill ' + (ok ? "ok" : "blocked") + '">' + escapeHtml(label) + '</span>').join("");
      detailEl.textContent = health.providerReady ? "Provider-backed retrieval is ready." : "Live now on packaged corpus. Provider-backed retrieval activates when secrets are set: " + health.missingSecrets.join(", ");
    }

    function renderQuestions(questions) {
      questionsEl.innerHTML = questions.map((item) => '<button class="ghost" data-question="' + escapeHtml(item.question) + '">' + escapeHtml(item.expectedPartNumber) + '</button>').join("");
      questionsEl.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
          questionInput.value = button.dataset.question;
          query(button.dataset.question);
        });
      });
    }

    async function query(question) {
      answerEl.textContent = "Querying...";
      sourcesEl.innerHTML = "";
      const data = await postJson("/query", { question });
      if (data.error) {
        renderError(answerEl, data.error);
        return;
      }
      answerEl.innerHTML = '<strong>Confidence: ' + escapeHtml(data.confidence) + '</strong> <span class="meta">mode: ' + escapeHtml(data.mode || "unknown") + '</span><br>' + escapeHtml(data.answer);
      sourcesEl.innerHTML = data.sources.map((source) => '<article class="source"><strong>' + escapeHtml(source.partNumber) + '</strong> <span class="meta">score ' + Number(source.score).toFixed(3) + '</span><br><a href="' + escapeHtml(source.sourceUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(source.title) + '</a><p>' + escapeHtml(source.excerpt) + '</p></article>').join("");
    }

    function renderEval(data) {
      if (data.error) {
        renderError(metricsEl, data.error);
        casesEl.innerHTML = "";
        return;
      }
      metricsEl.innerHTML = [
        ["Hit rate", data.hitRate],
        ["Top-1", data.top1Accuracy],
        ["Answer terms", data.answerTermAccuracy]
      ].map(([label, value]) => '<div class="metric"><span class="meta">' + label + '</span><strong>' + Math.round(value * 100) + '%</strong></div>').join("");
      casesEl.innerHTML = data.cases.map((item) => '<article class="case"><strong>' + escapeHtml(item.id) + '</strong><br><span class="meta">expected ' + escapeHtml(item.expectedPartNumber) + ', top ' + escapeHtml(item.topPart || "none") + ', confidence ' + escapeHtml(item.confidence) + '</span><br>' + escapeHtml(item.question) + '</article>').join("");
    }

    async function getJson(url) {
      const response = await fetch(url);
      return response.json();
    }

    async function postJson(url, body) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      return response.json();
    }

    async function runAction(button, fn) {
      button.disabled = true;
      try {
        await fn();
      } finally {
        button.disabled = false;
      }
    }

    function renderError(target, error) {
      target.innerHTML = '<div class="error"><strong>' + escapeHtml(error.code || "error") + '</strong><br>' + escapeHtml(error.message || JSON.stringify(error)) + '<br><span class="meta">' + escapeHtml(error.nextStep || "") + '</span></div>';
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
    }
  </script>
</body>
</html>`;
}
