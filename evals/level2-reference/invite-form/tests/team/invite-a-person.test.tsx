import { screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { db } from "../msw/handlers";
import { server } from "../msw/server";
import { renderAt } from "../render";

const name = () => screen.getByLabelText("Name");
const email = () => screen.getByLabelText("Email");
const send = () => screen.getByRole("button", { name: "Send invitation" });

describe("invite a person", () => {
  it("team/invite-a-person/the-form: a form with a Name field, an Email field and a Send invitation button", () => {
    renderAt("/people/invite");
    expect(name()).toBeInTheDocument();
    expect(email()).toBeInTheDocument();
    expect(send()).toBeInTheDocument();
  });

  it("team/invite-a-person/refused-before-sending: an empty or too long name is refused next to the field, with no request", async () => {
    let posts = 0;
    server.events.on("request:start", ({ request }) => void (request.method === "POST" && posts++));
    const { user } = renderAt("/people/invite");
    await user.type(email(), "rosa@clinic.example");
    await user.click(send());
    expect(name()).toHaveAccessibleDescription("Enter a name.");
    await user.type(name(), "N".repeat(81));
    await user.click(send());
    expect(name()).toHaveAccessibleDescription("Name is at most 80 characters.");
    expect(name()).toHaveValue("N".repeat(81));
    expect(email()).toHaveValue("rosa@clinic.example");
    expect(posts).toBe(0);
  });

  it("team/invite-a-person/invitation-sent: says Invitation sent with the email and empties the fields", async () => {
    const { user } = renderAt("/people/invite");
    await user.type(name(), "Rosa Park");
    await user.type(email(), "rosa@clinic.example");
    await user.click(send());
    expect(await screen.findByRole("status")).toHaveTextContent("Invitation sent to rosa@clinic.example.");
    expect(name()).toHaveValue("");
    expect(email()).toHaveValue("");
    expect(db.invitations).toHaveLength(2);
  });

  it("team/invite-a-person/field-error-from-the-api: shows the 422 message next to the email and keeps the values", async () => {
    const { user } = renderAt("/people/invite");
    await user.type(name(), "Rosa Park");
    await user.type(email(), "taken@clinic.example");
    await user.click(send());
    await waitFor(() => expect(email()).toBeInvalid());
    expect(email()).toHaveAccessibleDescription("This email already has a pending invitation.");
    expect(name()).toBeValid();
    expect(name()).toHaveValue("Rosa Park");
    expect(email()).toHaveValue("taken@clinic.example");
  });

  it("team/invite-a-person/send-once: a second submit while waiting sends no second request", async () => {
    let posts = 0;
    server.use(http.post("/api/invitations", async () => (posts++, await delay(100), HttpResponse.json({ id: "i9" }, { status: 201 }))));
    const { user } = renderAt("/people/invite");
    await user.type(name(), "Rosa Park");
    await user.type(email(), "rosa@clinic.example");
    await user.dblClick(send());
    await screen.findByRole("status");
    expect(posts).toBe(1);
  });

  it("team/invite-a-person/invitation-fails: an alert, the values kept, and the form can be sent again", async () => {
    server.use(http.post("/api/invitations", () => new HttpResponse(null, { status: 503 }), { once: true }));
    const { user } = renderAt("/people/invite");
    await user.type(name(), "Rosa Park");
    await user.type(email(), "rosa@clinic.example");
    await user.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent("The invitation could not be sent.");
    expect(name()).toHaveValue("Rosa Park");
    expect(send()).toBeEnabled();
    await user.click(send());
    expect(await screen.findByRole("status")).toHaveTextContent("Invitation sent");
  });
});
