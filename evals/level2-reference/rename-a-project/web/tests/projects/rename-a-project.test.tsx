import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { backend, signIn } from "../backend";
import { renderAt } from "../render";
import { resetProjectStore } from "../../projects/store";

beforeEach(() => resetProjectStore());

// Every test here goes through the real server: the screen sends its request to the Express app and shows its answer.
async function setup(who: "owner" | "member" = "owner") {
  const t = await backend();
  const ana = await t.seed.user("ana");
  const bo = await t.seed.user("bo");
  const alpha = await t.seed.team("Alpha", { owners: [ana], members: [bo] });
  const website = await t.seed.project(alpha.id, "Website");
  await t.seed.project(alpha.id, "Gamma");
  signIn(who === "owner" ? ana : bo);
  const nameInDb = async () => (await t.db.query<{ name: string }>("select name from projects where id = $1", [website.id]))[0]!.name;
  return { website, nameInDb };
}

const field = () => screen.getByRole("textbox", { name: "Name" });
const save = () => screen.getByRole("button", { name: "Save" });
const title = () => screen.getByRole("heading", { level: 1 });

describe("rename a project", () => {
  it("projects/rename-a-project/owner-renames: the page shows the name the server stored, without the spaces", async () => {
    const { website, nameInDb } = await setup();
    const { user } = renderAt(`/projects/${website.id}`);
    await screen.findByRole("heading", { name: "Website" });
    await user.clear(field());
    await user.type(field(), "  Apollo  ");
    await user.click(save());
    await waitFor(() => expect(title().textContent).toBe("Apollo"));
    expect(await nameInDb()).toBe("Apollo");
  });

  it("projects/rename-a-project/list-shows-the-new-name: going back to the list shows it, not the name the list had loaded", async () => {
    const { website } = await setup();
    const { user } = renderAt("/");
    await user.click(await screen.findByRole("link", { name: "Website" }));
    await screen.findByRole("heading", { name: "Website" });
    await user.clear(field());
    await user.type(field(), "Apollo");
    await user.click(save());
    await waitFor(() => expect(title().textContent).toBe("Apollo"));
    await user.click(screen.getByRole("link", { name: "Projects" }));
    expect(await screen.findByRole("link", { name: "Apollo" })).toHaveAttribute("href", `/projects/${website.id}`);
    expect(screen.queryByRole("link", { name: "Website" })).not.toBeInTheDocument();
  });

  it("projects/rename-a-project/name-already-taken: the field is invalid and says the name is taken, the typed name stays", async () => {
    const { website, nameInDb } = await setup();
    const { user } = renderAt(`/projects/${website.id}`);
    await screen.findByRole("heading", { name: "Website" });
    await user.clear(field());
    await user.type(field(), "gamma");
    await user.click(save());
    await waitFor(() => expect(field()).toHaveAttribute("aria-invalid", "true"));
    expect(field()).toHaveAccessibleDescription("That name is already taken in this team.");
    expect(field()).toHaveValue("gamma");
    expect(title()).toHaveTextContent("Website");
    expect(await nameInDb()).toBe("Website");
  });

  it("projects/rename-a-project/blank-name: the field is invalid and says a name is required", async () => {
    const { website, nameInDb } = await setup();
    const { user } = renderAt(`/projects/${website.id}`);
    await screen.findByRole("heading", { name: "Website" });
    await user.clear(field());
    await user.type(field(), "   ");
    await user.click(save());
    await waitFor(() => expect(field()).toHaveAttribute("aria-invalid", "true"));
    expect(field()).toHaveAccessibleDescription("Enter a name.");
    expect(await nameInDb()).toBe("Website");
  });

  it("projects/rename-a-project/member-is-refused: a member sees that only owners can rename, under the old name", async () => {
    const { website, nameInDb } = await setup("member");
    const { user } = renderAt(`/projects/${website.id}`);
    await screen.findByRole("heading", { name: "Website" });
    await user.clear(field());
    await user.type(field(), "Apollo");
    await user.click(save());
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/only owners/i)).toBeInTheDocument();
    expect(title()).toHaveTextContent("Website");
    expect(await nameInDb()).toBe("Website");
  });
});
