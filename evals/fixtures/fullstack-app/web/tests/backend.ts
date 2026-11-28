import { testApp, type TestApp } from "../../server/tests/helpers.ts";

/**
 * The API the web tests talk to: the real Express app over an in-memory PGlite, in this process. It starts at the first
 * request or the first call of `backend()` (a test that fakes every answer never starts the database), is emptied for
 * each test and closed after it (web/tests/setup.ts). `signIn` plays the browser's cookie jar: the forwarder
 * (web/tests/msw/handlers.ts) adds the signed-in user's `sid` cookie to every request.
 */
let current: TestApp | null = null;
let cookie: string | null = null;

/** The app for this test: its `seed` and `db` put rows in the very database the screens read. */
export async function backend(): Promise<TestApp> {
  current ??= await testApp();
  return current;
}

/** Signs the user in as the browser would: later requests carry their session cookie. */
export function signIn(user: { token: string }): void {
  cookie = `sid=${user.token}`;
}

export const sessionCookie = (): string | null => cookie;

export async function resetBackend(): Promise<void> {
  const t = current;
  current = null;
  cookie = null;
  await t?.close();
}
