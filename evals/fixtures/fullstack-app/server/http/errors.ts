import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ErrorBody } from "../../shared/errors.ts";

/**
 * An error the API means to return: its status and body reach the caller as they are. The body is
 * `{ error: { code, message?, fields? } }` (shared/errors.ts); `code` is the short name the API contract gives the error.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  readonly fields?: Record<string, string>;
  constructor(status: number, code: string, message?: string, fields?: Record<string, string>) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
    this.detail = message;
    this.fields = fields;
  }
  get body(): ErrorBody {
    return { error: { code: this.code, ...(this.detail ? { message: this.detail } : {}), ...(this.fields ? { fields: this.fields } : {}) } };
  }
}

export const unauthenticated = () => new HttpError(401, "unauthenticated", "Sign in first");
export const invalidRequest = (message?: string) => new HttpError(400, "invalid-request", message ?? "The request is not valid");

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json(new HttpError(404, "not-found", "No such route").body);
};

/** The last middleware: known errors as their body, a malformed JSON body as invalid-request, anything else as 500. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) return void res.status(err.status).json(err.body);
  if (err && typeof err === "object" && (err as { type?: string }).type === "entity.parse.failed") {
    return void res.status(400).json(invalidRequest("the body is not valid JSON").body);
  }
  // Unexpected: the caller gets no detail; the log gets the error, never the body or headers.
  console.error(`[${req.method} ${req.path}] unexpected error`, err);
  res.status(500).json(new HttpError(500, "internal-error", "Something went wrong").body);
};
