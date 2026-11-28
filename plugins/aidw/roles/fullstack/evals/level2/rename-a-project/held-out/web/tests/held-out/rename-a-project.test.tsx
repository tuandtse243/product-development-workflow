import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend, signIn } from "../backend";

/**
 * Held-out tests of the level 2 case rename-a-project: the project page and the list, driven through the app's router into
 * the real server (web/tests/backend.ts and web/tests/msw/handlers.ts, restored before grading, forward every /api/*
 * request to the Express app over a PGlite). Nothing is faked: the screen shows what the server answers, and the rows are
 * read from the database the server wrote. Each test loads the app afresh (the modules are reset), so no store a screen
 * keeps leaks from one test to the next.
 */
type App = Awaited<ReturnType<typeof open>>;

async function open(path: string) {
  const { renderAt } = await import("../render");
  return renderAt(path);
}

async function world(who: "owner" | "member" = "owner") {
  const t = await backend();
  const ana = await t.seed.user("ana");
  const bo = await t.seed.user("bo");
  const alpha = await t.seed.team("Alpha", { owners: [ana], members: [bo] });
  const website = await t.seed.project(alpha.id, "Website");
  await t.seed.project(alpha.id, "Gamma");
  signIn(who === "owner" ? ana : bo);
  const rowName = async () => (await t.db.query<{ name: string }>("select name from projects where id = $1", [website.id]))[0]!.name;
  return { t, website, rowName };
}

beforeEach(() => vi.resetModules());

const title = () => screen.getByRole("heading", { level: 1 });
const NAME = /name/i;

/** The name field; a page that keeps it behind a Rename or Edit button gets that button pressed first. */
async function nameField(user: App["user"]): Promise<HTMLElement> {
  await screen.findByRole("heading", { level: 1 });
  const there = () => screen.queryByRole("textbox", { name: NAME });
  if (!there()) await user.click(screen.getByRole("button", { name: /rename|edit/i }));
  return screen.findByRole("textbox", { name: NAME });
}

async function type(user: App["user"], field: HTMLElement, text: string) {
  await user.clear(field);
  await user.type(field, text);
}

/** Saves the form of the field: its submit button, or Enter when it has none that says so. */
async function save(user: App["user"], field: HTMLElement) {
  const form = field.closest("form");
  const button = form ? within(form).queryByRole("button", { name: /save|rename|update|confirm|apply|done/i }) : null;
  if (button) await user.click(button);
  else await user.type(field, "{Enter}");
}

/** The text of the elements a field names in aria-describedby. */
function describedBy(el: HTMLElement): string {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

describe("rename a project through the real server (held out)", () => {
  it("an owner types '  Apollo  ' and saves: the page shows exactly Apollo, and the row holds Apollo", async () => {
    const { website, rowName } = await world();
    const { user } = await open(`/projects/${website.id}`);
    const field = await nameField(user);
    await type(user, field, "  Apollo  ");
    await save(user, field);
    await waitFor(() => expect(title().textContent).toBe("Apollo"));
    expect(await rowName()).toBe("Apollo");
  });

  it("the list shows Apollo, and no longer Website, after the rename (the list had been loaded before)", async () => {
    const { website } = await world();
    const { user } = await open("/");
    await user.click(await screen.findByRole("link", { name: "Website" }));
    const field = await nameField(user);
    await type(user, field, "  Apollo  ");
    await save(user, field);
    await waitFor(() => expect(title().textContent).toBe("Apollo"));
    await user.click(screen.getByRole("link", { name: "Projects" }));
    const link = await screen.findByRole("link", { name: "Apollo" });
    expect(link.textContent).toBe("Apollo");
    expect(link).toHaveAttribute("href", `/projects/${website.id}`);
    expect(screen.queryByRole("link", { name: "Website" })).not.toBeInTheDocument();
  });

  it("a name another project of the team has: the name field is aria-invalid with text under it that says taken, from the server's 422", async () => {
    const { website, rowName } = await world();
    const { user } = await open(`/projects/${website.id}`);
    const field = await nameField(user);
    await type(user, field, "gamma");
    await save(user, field);
    await waitFor(() => expect(screen.getByRole("textbox", { name: NAME })).toHaveAttribute("aria-invalid", "true"));
    const now = screen.getByRole("textbox", { name: NAME });
    expect(describedBy(now)).toMatch(/taken|already|in use|exists|used/i);
    expect(describedBy(now)).not.toMatch(/something went wrong|could not be renamed|try again/i);
    expect(now).toHaveValue("gamma");
    expect(title()).toHaveTextContent("Website");
    expect(await rowName()).toBe("Website");
  });

  it("a blank name: the field is aria-invalid with text that says a name is needed, and the project keeps its name", async () => {
    const { website, rowName } = await world();
    const { user } = await open(`/projects/${website.id}`);
    const field = await nameField(user);
    await type(user, field, "   ");
    await save(user, field);
    await waitFor(() => expect(screen.getByRole("textbox", { name: NAME })).toHaveAttribute("aria-invalid", "true"));
    expect(describedBy(screen.getByRole("textbox", { name: NAME }))).toMatch(/required|enter a name|empty|blank|missing|give .*name|name is needed|must have|type a name|provide|needs a name/i);
    expect(title()).toHaveTextContent("Website");
    expect(await rowName()).toBe("Website");
  });

  it("a member who is not an owner: the server's 403 is a message that says only owners can rename; the page still stands, under the old name", async () => {
    const { website, rowName } = await world("member");
    const { user } = await open(`/projects/${website.id}`);
    const field = await nameField(user);
    await type(user, field, "Apollo");
    await save(user, field);
    const [message] = await screen.findAllByText(/owner|not allowed|allowed|permit|permission|only|cannot rename|can't rename|forbidden/i);
    expect(message.textContent).not.toMatch(/something went wrong|try again/i);
    expect(title()).toHaveTextContent("Website");
    expect(await rowName()).toBe("Website");
  });

  it("after a refused save the owner can still rename: the form is usable again", async () => {
    const { website, rowName } = await world();
    const { user } = await open(`/projects/${website.id}`);
    const field = await nameField(user);
    await type(user, field, "gamma");
    await save(user, field);
    await waitFor(() => expect(screen.getByRole("textbox", { name: NAME })).toHaveAttribute("aria-invalid", "true"));
    const again = screen.getByRole("textbox", { name: NAME });
    await type(user, again, "Apollo");
    await save(user, again);
    await waitFor(() => expect(title().textContent).toBe("Apollo"));
    expect(await rowName()).toBe("Apollo");
    // a form that closes after a save is fine; one that stays open must not still be marked invalid
    const stillOpen = screen.queryByRole("textbox", { name: NAME });
    if (stillOpen) expect(stillOpen).not.toHaveAttribute("aria-invalid", "true");
  });
});
