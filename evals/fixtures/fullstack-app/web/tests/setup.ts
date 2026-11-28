import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { resetBackend } from "./backend";
import { server } from "./msw/server";

// findBy* and waitFor wait up to 3 s: suites run under load, where 1 s is not always enough.
configure({ asyncUtilTimeout: 3000 });

// A request that no handler answers fails the test: nothing leaves the process.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(async () => {
  cleanup();
  server.resetHandlers();
  await resetBackend();
});
afterAll(() => server.close());
