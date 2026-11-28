import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetProjectStore } from "../../projects/store";
import { backend, signIn } from "../backend";
import { renderAt } from "../render";

beforeEach(() => resetProjectStore());

// These tests go through the real server (web/tests/msw/handlers.ts forwards /api/* to it): the screen reads what the API sends.
describe("the projects list", () => {
  it("lists the projects of the user's teams, each a link to its page", async () => {
    const t = await backend();
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", { owners: [ana] });
    const p = await t.seed.project(team.id, "Website");
    await t.seed.project((await t.seed.team("Other")).id, "Secret");
    signIn(ana);
    renderAt("/");
    expect(await screen.findByRole("link", { name: "Website" })).toHaveAttribute("href", `/projects/${p.id}`);
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
  });

  it("says there are no projects when the user's teams have none", async () => {
    const t = await backend();
    const ana = await t.seed.user("ana");
    await t.seed.team("Alpha", { owners: [ana] });
    signIn(ana);
    renderAt("/");
    expect(await screen.findByText("No projects yet.")).toBeInTheDocument();
  });

  it("says the projects could not be loaded when nobody is signed in", async () => {
    renderAt("/");
    expect(await screen.findByRole("alert")).toHaveTextContent("The projects could not be loaded.");
  });
});
