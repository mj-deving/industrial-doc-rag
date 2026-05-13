import { Hono } from "hono";
import { api } from "./api/routes";
import { jsonError } from "./api/errors";
import { renderConsole } from "./console/page";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.route("/", api);

app.get("/", (c) => {
  return c.html(renderConsole());
});

app.get("/console", (c) => {
  return c.html(renderConsole());
});

app.onError((error, c) => {
  return jsonError(c, error);
});

export default app;
