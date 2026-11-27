import type { Environment } from "vitest/environments";
import { builtinEnvironments } from "vitest/environments";

/**
 * Vitest's jsdom environment, with Node's own AbortController and AbortSignal kept. jsdom's signals are refused by
 * Node's `fetch` and `Request` ("Expected signal to be an instance of AbortSignal"), which React Router's navigations
 * and every `fetch(url, { signal })` use. jsdom's `addEventListener`, in turn, refuses Node's signal in
 * `{ signal }`, so it is wrapped: the signal is taken out of the options and an abort removes the listener. Everything
 * else is jsdom's.
 */
/** `addEventListener(type, fn, { signal })` with Node's AbortSignal: not added when already aborted, removed on abort. */
function allowNodeSignals(proto: EventTarget): void {
  const add = proto.addEventListener;
  proto.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (!options || typeof options !== "object" || !options.signal) return add.call(this, type, listener, options);
    const { signal, ...rest } = options;
    if (signal.aborted) return;
    add.call(this, type, listener, rest);
    signal.addEventListener("abort", () => this.removeEventListener(type, listener, rest), { once: true });
  };
}

const environment: Environment = {
  name: "jsdom-node-abort",
  transformMode: "web",
  async setup(global, options) {
    const { AbortController, AbortSignal } = globalThis;
    const env = await builtinEnvironments.jsdom.setup(global, options);
    global.AbortController = AbortController;
    global.AbortSignal = AbortSignal;
    allowNodeSignals(global.EventTarget.prototype);
    return env;
  },
};

export default environment;
