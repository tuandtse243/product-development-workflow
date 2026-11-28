import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { backend, signIn } from "../backend";
import { renderAt } from "../render";

// Through the real server (web/tests/msw/handlers.ts forwards /api/* to it): the screen shows what the API sends.
describe("the billing page", () => {
  it("lists the team's invoices with their amount and status", async () => {
    const t = await backend();
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", { owners: [ana] });
    await t.db.query("insert into invoices (team_id, number, amount_cents, status) values ($1, 'INV-001', 120000, 'paid')", [team.id]);
    signIn(ana);
    renderAt("/billing");
    expect(await screen.findByText("INV-001")).toBeInTheDocument();
    expect(screen.getByText("$1,200.00")).toBeInTheDocument();
    expect(screen.getByText("paid")).toBeInTheDocument();
  });

  it("says there are no invoices when the team has none", async () => {
    const t = await backend();
    const ana = await t.seed.user("ana");
    await t.seed.team("Alpha", { owners: [ana] });
    signIn(ana);
    renderAt("/billing");
    expect(await screen.findByText("No invoices yet.")).toBeInTheDocument();
  });
});
