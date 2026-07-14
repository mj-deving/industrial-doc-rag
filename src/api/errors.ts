import type { Context } from "hono";

export type ErrorCode = "bad_request" | "missing_secret" | "upstream_error";

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: 400 | 500 = 500,
    public readonly missingSecrets: string[] = []
  ) {
    super(message);
  }
}

export function badRequest(message: string): ApiError {
  return new ApiError("bad_request", message, 400);
}

export function missingSecretError(missingSecrets: string[]): ApiError {
  return new ApiError("missing_secret", `Missing required secret${missingSecrets.length === 1 ? "" : "s"}: ${missingSecrets.join(", ")}`, 500, missingSecrets);
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  const missingMatch = message.match(/^Missing ([A-Z0-9_]+)$/);
  if (missingMatch) {
    return missingSecretError([missingMatch[1]]);
  }

  return new ApiError("upstream_error", message, 500);
}

export function jsonError(c: Context, error: unknown): Response {
  const apiError = toApiError(error);
  // A 500 that leaves no trace is a 500 you debug by guessing. This handler caught a
  // `text.indexOf is not a function` from the planner and returned it as a tidy JSON
  // body, so `wrangler tail` reported `outcome: ok, exceptions: []` and the stack was
  // gone. The response tells a caller WHAT broke; only this tells us WHERE.
  if (apiError.status === 500) {
    console.error(`500 ${c.req.method} ${new URL(c.req.url).pathname}`, error);
  }
  return c.json(
    {
      error: {
        code: apiError.code,
        message: apiError.message,
        missingSecrets: apiError.missingSecrets,
        nextStep: nextStepFor(apiError)
      }
    },
    apiError.status
  );
}

function nextStepFor(error: ApiError): string {
  if (error.code === "missing_secret") {
    return `Set Worker secret${error.missingSecrets.length === 1 ? "" : "s"} ${error.missingSecrets.join(", ")} and redeploy.`;
  }
  if (error.code === "bad_request") {
    return "Fix the request payload and retry.";
  }
  return "Check Worker logs and upstream provider configuration.";
}
