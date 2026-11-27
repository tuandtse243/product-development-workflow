import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../msw/handlers";
import { server } from "../msw/server";
import { renderAt } from "../render";

const OWNER = { id: "u1", name: "Rosa Park", role: "owner" } as const;

afterEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
});

describe("billing for owners", () => {
  it("billing/billing-for-owners/checking-access: says it is checking access until the session answers, with no billing request", async () => {
    let billingReads = 0;
    server.events.on("request:start", ({ request }) => void (new URL(request.url).pathname === "/api/billing" && billingReads++));
    db.session = { ...OWNER };
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    server.use(http.get("/api/session", async () => (await gate, HttpResponse.json({ user: OWNER }))));
    renderAt("/billing");
    expect(screen.getByRole("status")).toHaveTextContent("Checking your access…");
    expect(billingReads).toBe(0);
    release();
    expect(await screen.findByText("Clinic Plus")).toBeInTheDocument();
  });

  it("billing/billing-for-owners/billing-for-an-owner: shows the plan, the balance due as money and the next invoice", async () => {
    db.session = { ...OWNER };
    renderAt("/billing");
    expect(await screen.findByText("Clinic Plus")).toBeInTheDocument();
    expect(screen.getByText("€129.00")).toBeInTheDocument();
    expect(screen.getByText("Fri 1 Feb 2030")).toBeInTheDocument();
  });

  it("billing/billing-for-owners/signed-out: goes to /login?next=/billing with no billing request", async () => {
    let billingReads = 0;
    server.events.on("request:start", ({ request }) => void (new URL(request.url).pathname === "/api/billing" && billingReads++));
    const { router } = renderAt("/billing");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?next=%2Fbilling");
    expect(billingReads).toBe(0);
  });

  it("billing/billing-for-owners/members-see-an-owners-only-page: says Owners only whatever localStorage holds, with no billing request", async () => {
    let billingReads = 0;
    server.events.on("request:start", ({ request }) => void (new URL(request.url).pathname === "/api/billing" && billingReads++));
    db.session = { id: "u2", name: "Tomas Okafor", role: "member" };
    localStorage.setItem("role", "owner");
    renderAt("/billing");
    expect(await screen.findByRole("heading", { name: "Owners only" })).toBeInTheDocument();
    expect(billingReads).toBe(0);
  });

  it("billing/billing-for-owners/test-mode-badge: says Test mode when the publishable key is a test key", async () => {
    db.session = { ...OWNER };
    vi.stubEnv("VITE_STRIPE_PUBLISHABLE_KEY", "pk_test_abc");
    renderAt("/billing");
    expect(await screen.findByText("Test mode")).toBeInTheDocument();
    vi.stubEnv("VITE_STRIPE_PUBLISHABLE_KEY", "pk_live_abc");
  });
});
