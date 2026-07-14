import { Hono } from "hono";
import { api } from "./api/routes";
import { ingest } from "./api/ingest";
import { evalApi } from "./api/eval";
import { extract } from "./api/extract";
import { jsonError } from "./api/errors";
import { renderConsole } from "./console/page";
import { renderEval } from "./console/eval-page";
import type { CorpusBaseline, CorpusEval, Results, Scale } from "./console/eval-data";
import results from "../data/eval-results.json";
import scale from "../data/eval-scale.json";
import corpusEval from "../data/eval-corpus.json";
import corpusBaseline from "../data/eval-corpus-baseline.json";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.route("/", api);
app.route("/", ingest);
app.route("/", evalApi);
app.route("/", extract);

app.get("/", (c) => {
  return c.html(renderConsole());
});

app.get("/console", (c) => {
  return c.html(renderConsole());
});

// Public, unauthenticated, and static. The token-guarded /eval/* harness routes
// above RUN the eval; this one only prints what a previous run committed to the
// repository. The two share a prefix and nothing else.
app.get("/eval", (c) => {
  return c.html(
    renderEval(
      results as Results,
      scale as Scale,
      corpusEval as unknown as CorpusEval,
      corpusBaseline as unknown as CorpusBaseline
    )
  );
});

app.onError((error, c) => {
  return jsonError(c, error);
});

export default app;
