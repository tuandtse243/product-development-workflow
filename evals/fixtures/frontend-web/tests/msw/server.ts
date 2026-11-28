import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/** The tests' network: every `fetch` is answered here, in-process. Started and reset by tests/setup.ts. */
export const server = setupServer(...handlers);
