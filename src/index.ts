import { Hono } from "hono";
import { api } from "./api/routes";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.route("/", api);

app.get("/", (c) => {
  return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Industrial Datasheet RAG</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #f7f8fb; color: #172033; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    p { color: #526173; margin: 0 0 24px; }
    form { display: grid; gap: 12px; grid-template-columns: 1fr auto; margin-bottom: 20px; }
    input { min-height: 44px; padding: 0 14px; border: 1px solid #c8d0dc; border-radius: 6px; font-size: 16px; }
    button { min-height: 44px; padding: 0 16px; border: 0; border-radius: 6px; background: #205cc8; color: white; font-weight: 650; cursor: pointer; }
    pre, .panel { background: white; border: 1px solid #dde3eb; border-radius: 8px; padding: 16px; overflow: auto; }
    .sources { display: grid; gap: 10px; margin-top: 12px; }
    .source { background: white; border: 1px solid #dde3eb; border-radius: 8px; padding: 12px; }
    .meta { color: #526173; font-size: 13px; }
    @media (prefers-color-scheme: dark) {
      body { background: #0d1117; color: #e6edf3; }
      p, .meta { color: #9fb0c3; }
      pre, .panel, .source { background: #151b23; border-color: #303b4a; }
      input { background: #0d1117; color: #e6edf3; border-color: #303b4a; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Industrial Datasheet RAG</h1>
    <p>Hono Worker over Infineon MOSFET datasheets: query, inspect retrieved sources, run eval.</p>
    <form id="query-form">
      <input id="question" name="question" value="What is the maximum RDS(on) for IPB017N10N5?" autocomplete="off">
      <button type="submit">Query</button>
    </form>
    <section class="panel" id="answer">No query yet.</section>
    <section class="sources" id="sources"></section>
  </main>
  <script>
    const form = document.querySelector("#query-form");
    const answer = document.querySelector("#answer");
    const sources = document.querySelector("#sources");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      answer.textContent = "Querying...";
      sources.innerHTML = "";
      const response = await fetch("/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: new FormData(form).get("question") })
      });
      const data = await response.json();
      if (!response.ok) {
        answer.textContent = data.error || JSON.stringify(data, null, 2);
        return;
      }
      answer.innerHTML = "<strong>Confidence: " + data.confidence + "</strong><br>" + escapeHtml(data.answer);
      sources.innerHTML = data.sources.map((source) => {
        return '<article class="source"><strong>' + escapeHtml(source.partNumber) + '</strong> <span class="meta">score ' + source.score.toFixed(3) + '</span><br><a href="' + source.sourceUrl + '" target="_blank" rel="noreferrer">' + escapeHtml(source.title) + '</a><p>' + escapeHtml(source.excerpt) + '</p></article>';
      }).join("");
    });
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
    }
  </script>
</body>
</html>`);
});

app.onError((error, c) => {
  return c.json({ error: error.message }, 500);
});

export default app;
