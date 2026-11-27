/**
 * The only module that calls `fetch`. Paths are the API's (`/api/...`); they are resolved against the page's origin, which
 * the dev server proxies to the API (vite.config.ts) and the tests answer with MSW (tests/msw/).
 */

/** An error answer of the API: its status and the `type` of its problem body (`internal-error` when it has none). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const url = (path: string): string => new URL(path, window.location.origin).toString();

async function failure(res: Response): Promise<ApiError> {
  let type = "internal-error";
  let title = res.statusText || `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { type?: unknown; title?: unknown };
    if (typeof body.type === "string") type = body.type;
    if (typeof body.title === "string") title = body.title;
  } catch {
    /* no problem body */
  }
  return new ApiError(res.status, type, title);
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
