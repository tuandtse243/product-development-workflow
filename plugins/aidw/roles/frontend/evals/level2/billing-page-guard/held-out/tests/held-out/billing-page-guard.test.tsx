import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../msw/handlers";
import { server } from "../msw/server";
import { renderAt } from "../render";

/**
 * Held-out tests of the level 2 case billing-page-guard: the route /billing through the app's router and the fixture's
 * MSW handlers (tests/msw/handlers.ts, restored before grading): `db.session` is who the API says is signed in (null:
 * nobody, 401), GET /api/billing answers an owner and refuses anyone else. The browser's own `localStorage.role` is set
 * to the opposite of the session's wherever a test needs to show it decides nothing. The app is built with a Stripe
 * test key (VITE_STRIPE_PUBLISHABLE_KEY), set before any module of the app is loaded.
 */
vi.hoisted(() => {
  vi.stubEnv("VITE_STRIPE_PUBLISHABLE_KEY", "pk_test_held_out_key");
});

const OWNER = { id: "u1", name: "Rosa Park", role: "owner" } as const;
const MEMBER = { id: "u2", name: "Tomas Okafor", role: "member" } as const;

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  localStorage.clear();
});

/** Counts the GET requests for billing from now on. */
function countBillingReads(): { count: () => number } {
  let n = 0;
  const on = ({ request }: { request: Request }) => {
    if (request.method === "GET" && new URL(request.url).pathname === "/api/billing") n++;
  };
  server.events.on("request:start", on);
  stop = () => server.events.removeListener("request:start", on);
  return { count: () => n };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("billing page guard (held out)", () => {
  it("while the session answer has not arrived the screen says it is checking access, and no billing request is sent", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    db.session = { ...OWNER };
    server.use(
      http.get("/api/session", async () => {
        await gate;
        return HttpResponse.json({ user: OWNER });
      }),
    );
    const reads = countBillingReads();
    renderAt("/billing");
    await waitFor(() => expect(screen.queryAllByText(/checking|verifying|please wait|loading/i).length + screen.queryAllByRole("status").length).toBeGreaterThan(0));
    await tick(100);
    expect(reads.count()).toBe(0);
    expect(screen.queryByText(/clinic plus/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/owners only/i)).not.toBeInTheDocument();
    release();
    expect(await screen.findByText(/clinic plus/i)).toBeInTheDocument();
  });

  it("an owner sees the plan, the balance due as money and the date of the next invoice", async () => {
    db.session = { ...OWNER };
    renderAt("/billing");
    expect(await screen.findByText(/clinic plus/i)).toBeInTheDocument();
    const text = () => document.body.textContent ?? "";
    expect(text()).toMatch(/129/);
    expect(text()).toMatch(/€|EUR/);
    expect(text()).toMatch(/2030/);
    expect(text()).toMatch(/feb|02/i);
    expect(screen.queryByText(/owners only/i)).not.toBeInTheDocument();
  });

  it("an owner is an owner whatever the browser has stored about the role", async () => {
    db.session = { ...OWNER };
    localStorage.setItem("role", "member");
    renderAt("/billing");
    expect(await screen.findByText(/clinic plus/i)).toBeInTheDocument();
    expect(screen.queryByText(/owners only/i)).not.toBeInTheDocument();
  });

  it("signed out, the visitor is sent to /login with next=/billing, and no billing request is sent", async () => {
    db.session = null;
    const reads = countBillingReads();
    const { router } = renderAt("/billing");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(new URLSearchParams(router.state.location.search).get("next")).toBe("/billing");
    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    await tick(100);
    expect(reads.count()).toBe(0);
    expect(screen.queryByText(/clinic plus/i)).not.toBeInTheDocument();
  });

  it("a member sees that the page is for owners only, whatever localStorage says, and no billing request is sent", async () => {
    db.session = { ...MEMBER };
    localStorage.setItem("role", "owner");
    const reads = countBillingReads();
    const { router } = renderAt("/billing");
    expect(await screen.findByText(/owners only/i)).toBeInTheDocument();
    await tick(150);
    expect(reads.count()).toBe(0);
    expect(router.state.location.pathname).toBe("/billing");
    expect(screen.queryByText(/clinic plus/i)).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/129/);
  });

  it("an owner of an app built with a Stripe test key sees Test mode", async () => {
    db.session = { ...OWNER };
    renderAt("/billing");
    await screen.findByText(/clinic plus/i);
    expect(screen.getByText(/test mode/i)).toBeInTheDocument();
  });
});
