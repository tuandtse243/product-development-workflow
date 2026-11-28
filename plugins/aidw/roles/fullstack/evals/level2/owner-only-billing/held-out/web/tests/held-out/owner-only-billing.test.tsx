import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backend, signIn } from "../backend";

/**
 * Held-out tests of the level 2 case owner-only-billing: the billing page, driven through the app's router into the real
 * server (web/tests/backend.ts and web/tests/msw/handlers.ts, restored before grading, forward every /api/* request to the
 * Express app over a PGlite). Nothing is faked: the page shows what the server answers. What the browser keeps in
 * localStorage is set on purpose: the server decides, not the browser.
 */
async function open(path: string) {
  const { renderAt } = await import("../render");
  return renderAt(path);
}

async function world(who: "owner" | "member") {
  const t = await backend();
  const ana = await t.seed.user("ana");
  const bo = await t.seed.user("bo");
  const alpha = await t.seed.team("Alpha", { owners: [ana], members: [bo] });
  const beta = await t.seed.team("Beta", { owners: [await t.seed.user("cy")] });
  await t.db.query("insert into invoices (team_id, number, amount_cents, status) values ($1, 'INV-2026-001', 120000, 'paid'), ($1, 'INV-2026-002', 4900, 'open'), ($2, 'INV-2026-900', 777, 'open')", [alpha.id, beta.id]);
  signIn(who === "owner" ? ana : bo);
}

beforeEach(() => vi.resetModules());
afterEach(() => localStorage.clear());

const OWNERS_ONLY = /\bowners?\b/i;

/** The page with a member's answer settled: the "owners only" text is there, and the invoice data is nowhere. */
async function expectOwnersOnlyNoData() {
  await screen.findByText(OWNERS_ONLY);
  await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
  const text = document.body.textContent ?? "";
  expect(text).not.toMatch(/INV-2026|1,200|1200|49\.00|\$49|777/);
  expect(text).not.toMatch(/could not be loaded|something went wrong|try again/i);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
}

describe("owner-only billing through the real server (held out)", () => {
  it("an owner opens the billing page: the team's invoices are listed with number, amount and status, and no other team's", async () => {
    await world("owner");
    await open("/billing");
    expect(await screen.findByText("INV-2026-001")).toBeInTheDocument();
    expect(screen.getByText("INV-2026-002")).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/1,?200(\.00)?/);
    expect(document.body.textContent).toMatch(/49(\.00)?/);
    expect(screen.getByText(/^paid$/i)).toBeInTheDocument();
    expect(screen.getByText(/^open$/i)).toBeInTheDocument();
    expect(screen.queryByText("INV-2026-900")).not.toBeInTheDocument();
    expect(screen.queryByText(OWNERS_ONLY)).not.toBeInTheDocument();
  });

  it("an owner whose browser says role=member still sees the invoices: the server decides", async () => {
    await world("owner");
    localStorage.setItem("role", "member");
    await open("/billing");
    expect(await screen.findByText("INV-2026-001")).toBeInTheDocument();
    expect(screen.queryByText(OWNERS_ONLY)).not.toBeInTheDocument();
  });

  it("a member opens the billing page: it says billing is for owners only, with no invoice on it (the server's 403)", async () => {
    await world("member");
    await open("/billing");
    await expectOwnersOnlyNoData();
  });

  it("a member whose browser says role=owner gets the same: the server decides, not localStorage", async () => {
    await world("member");
    localStorage.setItem("role", "owner");
    await open("/billing");
    await expectOwnersOnlyNoData();
  });
});
