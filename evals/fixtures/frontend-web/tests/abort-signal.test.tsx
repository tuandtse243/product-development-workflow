import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "./msw/server";

/** The test environment (tests/environment.ts) keeps Node's AbortSignal: jsdom's events and Node's fetch both take it. */
describe("AbortSignal in the test environment", () => {
  it("removes a document keydown listener added with { signal } when the signal aborts", () => {
    const seen: string[] = [];
    const controller = new AbortController();
    document.addEventListener("keydown", (e) => seen.push(e.key), { signal: controller.signal });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    controller.abort();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    expect(seen).toEqual(["a"]);
  });

  it("adds no listener with a signal that is already aborted, and keeps the other options", () => {
    const seen: string[] = [];
    const done = AbortSignal.abort();
    document.addEventListener("keydown", () => seen.push("late"), { signal: done });
    document.addEventListener("keydown", () => seen.push("once"), { once: true, signal: new AbortController().signal });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(seen).toEqual(["once"]);
  });

  it("lets fetch take a signal, and refuses a request whose signal aborted", async () => {
    server.use(http.get("/api/ping", () => HttpResponse.json({ ok: true })));
    const controller = new AbortController();
    const res = await fetch("/api/ping", { signal: controller.signal });
    expect(await res.json()).toEqual({ ok: true });
    controller.abort();
    await expect(fetch("/api/ping", { signal: controller.signal })).rejects.toThrow();
  });
});
