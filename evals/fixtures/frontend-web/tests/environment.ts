import type { Environment } from "vitest/environments";
import { builtinEnvironments } from "vitest/environments";

/**
 * Vitest's jsdom environment, with Node's own AbortController and AbortSignal kept. jsdom's signals are refused by
 * Node's `fetch` and `Request` ("Expected signal to be an instance of AbortSignal"), which React Router's navigations
 * and every `fetch(url, { signal })` use. Everything else is jsdom's.
 */
const environment: Environment = {
  name: "jsdom-node-abort",
  transformMode: "web",
  async setup(global, options) {
    const { AbortController, AbortSignal } = globalThis;
    const env = await builtinEnvironments.jsdom.setup(global, options);
    global.AbortController = AbortController;
    global.AbortSignal = AbortSignal;
    return env;
  },
};

export default environment;
