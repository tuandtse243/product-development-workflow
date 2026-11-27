import type { Environment } from "vitest/environments";
import { builtinEnvironments } from "vitest/environments";

/**
 * Vitest's jsdom environment, with Node's own AbortController and AbortSignal kept. jsdom's signals are refused by
 * Node's `fetch` and `Request` ("Expected signal to be an instance of AbortSignal"), which React Router's navigations
 * and every `fetch(url, { signal })` use. jsdom's `addEventListener`, in turn, refuses Node's signal in
 * `{ signal }`, so it is wrapped: the signal is taken out of the options and an abort removes the listener. Everything
 * else is jsdom's.
 */
type Entry = { off: (() => void) | null };
/** Per target, type, capture flag and listener: the abort hook of a listener added with a signal (`off`), if any. */
const registered = new WeakMap<object, Map<string, Map<boolean, WeakMap<object, Entry>>>>();
const captureOf = (o?: boolean | EventListenerOptions) => (typeof o === "object" && o !== null ? !!o.capture : !!o);
const slot = (target: object, type: string, capture: boolean, make: boolean) => {
  let types = registered.get(target);
  if (!types && make) registered.set(target, (types = new Map()));
  let flags = types?.get(type);
  if (!flags && make) types?.set(type, (flags = new Map()));
  let listeners = flags?.get(capture);
  if (!listeners && make) flags?.set(capture, (listeners = new WeakMap()));
  return listeners;
};

/**
 * `addEventListener(type, fn, { signal })` with Node's AbortSignal, like a browser: not added when already aborted,
 * removed on abort; a duplicate add (same type, capture and listener) is ignored, so its signal removes nothing; a
 * listener removed by hand is no longer removed by the abort of its old signal. Patches the object's own methods.
 */
function allowNodeSignals(proto: EventTarget): void {
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  proto.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    const signal = typeof options === "object" && options !== null ? options.signal : undefined;
    if (!signal) {
      if (listener && !(typeof options === "object" && options?.once)) {
        const listeners = slot(this, type, captureOf(options), true)!;
        if (!listeners.has(listener)) listeners.set(listener, { off: null });
      }
      return add.call(this, type, listener, options);
    }
    const { signal: _signal, ...rest } = options as AddEventListenerOptions;
    if (signal.aborted) return;
    const capture = captureOf(rest);
    const known = listener ? slot(this, type, capture, false)?.get(listener) : undefined;
    if (known) return; // already registered: the browser ignores this add, and so does its signal
    const hook = () => {
      if (listener) slot(this, type, capture, false)?.delete(listener);
      remove.call(this, type, listener, rest);
    };
    if (listener && !rest.once) slot(this, type, capture, true)!.set(listener, { off: () => signal.removeEventListener("abort", hook) });
    add.call(this, type, listener, rest);
    signal.addEventListener("abort", hook, { once: true });
  };
  proto.removeEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    if (listener) {
      const listeners = slot(this, type, captureOf(options), false);
      listeners?.get(listener)?.off?.();
      listeners?.delete(listener);
    }
    return remove.call(this, type, listener, options);
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
    // jsdom's window has its own addEventListener, which EventTarget.prototype does not reach
    const dom = (global as { jsdom?: { window: EventTarget } }).jsdom;
    const own = new Set<EventTarget>([global as unknown as EventTarget, (global as { window?: EventTarget }).window as EventTarget, dom?.window as EventTarget]);
    for (const t of own) if (t && Object.prototype.hasOwnProperty.call(t, "addEventListener")) allowNodeSignals(t);
    return env;
  },
};

export default environment;
