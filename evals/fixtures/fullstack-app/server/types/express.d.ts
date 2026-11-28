import type { SessionUser } from "../auth/sessions.ts";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireSession; absent on public routes. */
      session?: SessionUser;
    }
  }
}

export {};
