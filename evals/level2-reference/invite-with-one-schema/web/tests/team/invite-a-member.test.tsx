import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { backend, signIn } from "../backend";
import { server } from "../msw/server";
import { renderAt } from "../render";

// Through the real server (web/tests/msw/handlers.ts forwards /api/* to it): the dialog shows what the API answers.
async function world(who: "owner" | "member") {
  const t = await backend();
  const ana = await t.seed.user("ana");
  const bo = await t.seed.user("bo");
  await t.seed.team("Alpha", { owners: [ana], members: [bo] });
  signIn(who === "owner" ? ana : bo);
  return t;
}

async function openDialog() {
  const { user } = renderAt("/team");
  await user.click(await screen.findByRole("button", { name: "Invite a member" }));
  return { user, dialog: await screen.findByRole("dialog") };
}

describe("the invite dialog", () => {
  it("invites/invite-a-member/owner-invites-a-member: an owner invites; the dialog closes and the server holds the trimmed name", async () => {
    const t = await world("owner");
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText("Name"), "  Dana White  ");
    await user.type(within(dialog).getByLabelText("Email"), "dana@example.test");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Invited Dana White.")).toBeInTheDocument();
    expect(await t.db.query("select name, email from invites")).toEqual([{ name: "Dana White", email: "dana@example.test" }]);
  });

  it("invites/invite-a-member/name-too-long: 81 characters are refused on the form, before any request", async () => {
    const t = await world("owner");
    const sent: string[] = [];
    const log = ({ request }: { request: Request }) => void sent.push(`${request.method} ${new URL(request.url).pathname}`);
    server.events.on("request:start", log);
    const { user, dialog } = await openDialog();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "x".repeat(81) } });
    await user.type(within(dialog).getByLabelText("Email"), "dana@example.test");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));
    const field = within(dialog).getByLabelText("Name");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/too long/i);
    server.events.removeListener("request:start", log);
    expect(sent.filter((s) => s.startsWith("POST /api/invites"))).toEqual([]);
    expect(await t.db.query("select 1 from invites")).toEqual([]);
  });

  it("invites/invite-a-member/email-not-valid: an email that is not one is refused on the form", async () => {
    await world("owner");
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText("Name"), "Dana");
    await user.type(within(dialog).getByLabelText("Email"), "not-an-email");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));
    const field = within(dialog).getByLabelText("Email");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/not valid/i);
  });

  it("invites/invite-a-member/member-is-refused: a member is told that only owners can invite", async () => {
    const t = await world("member");
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText("Name"), "Dana");
    await user.type(within(dialog).getByLabelText("Email"), "dana@example.test");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/only owners/i);
    expect(await t.db.query("select 1 from invites")).toEqual([]);
  });
});
