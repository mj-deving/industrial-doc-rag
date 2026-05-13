import { Hono } from "hono";
import { api } from "./api/routes";
import { jsonError } from "./api/errors";
import { renderDemoCockpit } from "./demo/page";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.route("/", api);

app.get("/", (c) => {
  return c.html(renderDemoCockpit());
});

app.get("/demo", (c) => {
  return c.html(renderDemoCockpit());
});

app.onError((error, c) => {
  return jsonError(c, error);
});

export default app;
