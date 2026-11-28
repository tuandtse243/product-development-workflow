import { errorBodySchema } from "../../shared/errors.ts";

/**
 * The only module that calls `fetch`. Paths are the API's (`/api/...`); they are resolved against the page's origin, which
 * the dev server proxies to the API (vite.config.ts) and the tests forward to the Express app (web/tests/msw/).
 */

/**
 * An error answer of the API: its status, the `code` of its error body (`unknown` when it has none), the message to show
 * and, for a 422 `validation`, the reason per field.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = "unknown",
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const url = (path: string): string => new URL(path, window.location.origin).toString();

async function failure(res: Response): Promise<ApiError> {
  const fallback = res.statusText || `HTTP ${res.status}`;
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    if (parsed.success) {
      const { code, message, fields } = parsed.data.error;
      return new ApiError(res.status, message ?? fallback, code, fields);
    }
  } catch {
    /* no JSON body */
  }
  return new ApiError(res.status, fallback);
}

/** GET a JSON resource; an error status throws ApiError. */
export async function getJson<T>(path: string, init: { signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(url(path), { headers: { accept: "application/json" }, signal: init.signal });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

async function sendJson<T>(method: string, path: string, body: unknown, init: { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(url(path), {
    method,
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: init.signal,
  });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

/** POST a JSON body; an error status throws ApiError. */
export const postJson = <T>(path: string, body: unknown, init: { signal?: AbortSignal } = {}): Promise<T> => sendJson<T>("POST", path, body, init);

/** PATCH a JSON body; an error status throws ApiError. */
export const patchJson = <T>(path: string, body: unknown, init: { signal?: AbortSignal } = {}): Promise<T> => sendJson<T>("PATCH", path, body, init);
