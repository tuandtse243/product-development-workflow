import type { ErrorRequestHandler, RequestHandler } from "express";

/**
 * Errors as problem bodies (RFC 9457 shape): `{ type, title, status, detail? }`, content type
 * `application/problem+json`. `type` is the short name the API contract gives the error.
 */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
}

/** An error the API means to return: its status and problem body reach the caller as they are. */
export class HttpError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail?: string;
  constructor(status: number, type: string, title: string, detail?: string) {
    super(`${status} ${type}`);
    this.status = status;
    this.type = type;
    this.title = title;
    this.detail = detail;
  }
  get problem(): Problem {
    return { type: this.type, title: this.title, status: this.status, ...(this.detail ? { detail: this.detail } : {}) };
  }
}

export const unauthenticated = () => new HttpError(401, "unauthenticated", "Sign in first");
export const invalidRequest = (detail?: string) => new HttpError(400, "invalid-request", "The request is not valid", detail);

const send = (res: Parameters<ErrorRequestHandler>[2], p: Problem) => res.status(p.status).type("application/problem+json").json(p);

export const notFound: RequestHandler = (_req, res) => {
  send(res, { type: "not-found", title: "No such route", status: 404 });
};

/** The last middleware: known errors as their problem, a malformed JSON body as invalid-request, anything else as 500. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) return send(res, err.problem);
  if (err && typeof err === "object" && (err as { type?: string }).type === "entity.parse.failed") {
    return send(res, invalidRequest("the body is not valid JSON").problem);
  }
  // Unexpected: the caller gets no detail; the log gets the error and the request id, never the body or headers.
  console.error(`[${req.method} ${req.path}] unexpected error`, err);
  return send(res, { type: "internal-error", title: "Something went wrong", status: 500 });
};
