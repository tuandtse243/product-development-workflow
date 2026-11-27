/**
 * The only module that calls `fetch`. Paths are the API's (`/api/...`); they are resolved against the page's origin, which
 * the dev server proxies to the API (vite.config.ts) and the tests answer with MSW (tests/msw/).
 */

/**
 * An error answer of the API: its status, the `type` of its problem body (`internal-error` when it has none) and the
 * parsed body itself (`null` when there is none), for the fields a contract adds to it (a 422's `errors`).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const url = (path: string): string => new URL(path, window.location.origin).toString();

async function failure(res: Response): Promise<ApiError> {
  let type = "internal-error";
  let title = res.statusText || `HTTP ${res.status}`;
  let parsed: unknown = null;
  try {
    parsed = await res.json();
    const body = parsed as { type?: unknown; title?: unknown };
    if (typeof body.type === "string") type = body.type;
    if (typeof body.title === "string") title = body.title;
  } catch {
    /* no problem body */
  }
  return new ApiError(res.status, type, title, parsed);
}

/** GET a JSON resource; an error status throws ApiError. */
export async function getJson<T>(path: string, init: { signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(url(path), { headers: { accept: "application/json" }, signal: init.signal });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

/** POST a JSON body; an error status throws ApiError. */
export async function postJson<T>(path: string, body: unknown, init: { signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(url(path), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: init.signal,
  });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}
