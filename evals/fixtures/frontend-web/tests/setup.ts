import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { resetDb } from "./msw/handlers";
import { server } from "./msw/server";

// findBy* and waitFor wait up to 3 s: suites run under load, where 1 s is not always enough.
configure({ asyncUtilTimeout: 3000 });

// A request with no handler fails the test: nothing leaves the process.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetDb();
});
afterAll(() => server.close());
