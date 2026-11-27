import { screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../msw/handlers";
import { server } from "../msw/server";
import { renderAt } from "../render";

/**
 * Held-out tests of the level 2 case invite-form: the form at /people/invite, through the app's router and the
 * fixture's MSW handlers (tests/msw/handlers.ts, restored before grading). The handler answers 422 with `errors` for a
 * name that is empty or over 80 characters, an email that is not an address, and an email that already has a pending
 * invitation (taken@clinic.example is one). Requests are counted from the MSW log, never from the screen.
 */
const URL_PATH = "/api/invitations";
const FORM = "/people/invite";
const GOOD = { name: "Rosa Park", email: "rosa@clinic.example" };

const nameField = () => screen.getByLabelText(/name/i);
const emailField = () => screen.getByLabelText(/email/i);
const sendButton = () => screen.getByRole("button", { name: /send invitation/i });

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
});

/** The bodies of the POST requests to the invitations operation from now on. */
function watchPosts(): { bodies: () => { name: string; email: string }[] } {
  const seen: { name: string; email: string }[] = [];
  const on = async ({ request }: { request: Request }) => {
    if (request.method === "POST" && new URL(request.url).pathname === URL_PATH) seen.push((await request.clone().json()) as { name: string; email: string });
  };
  server.events.on("request:start", on);
  stop = () => server.events.removeListener("request:start", on);
  return { bodies: () => seen };
}

type User = ReturnType<typeof renderAt>["user"];
async function fill(user: User, v: { name?: string; email?: string }) {
  if (v.name !== undefined) {
    await user.click(nameField());
    if (v.name) await user.paste(v.name);
  }
  if (v.email !== undefined) {
    await user.click(emailField());
    if (v.email) await user.paste(v.email);
  }
}

/** The text of the elements a field names in aria-describedby. */
function describedBy(el: HTMLElement): string {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

describe("invite a person (held out)", () => {
  it("the form has a Name field, an Email field and a Send invitation button, each field labelled", async () => {
    renderAt(FORM);
    expect(nameField()).toBeInTheDocument();
    expect(emailField()).toBeInTheDocument();
    expect(nameField()).not.toBe(emailField());
    expect(sendButton()).toBeEnabled();
  });

  it("an empty name is refused before any request, with its message tied to the Name field and what was typed kept", async () => {
    const posts = watchPosts();
    const { user } = renderAt(FORM);
    await fill(user, { email: GOOD.email });
    await user.click(sendButton());
    await waitFor(() => expect(describedBy(nameField())).not.toBe(""));
    await new Promise((r) => setTimeout(r, 120));
    expect(posts.bodies()).toEqual([]);
    expect(emailField()).toHaveValue(GOOD.email);
    expect(emailField()).not.toHaveAttribute("aria-invalid", "true");
  });

  it("a name of 81 characters is never sent: it is refused with a message on the Name field, or it cannot be typed", async () => {
    const posts = watchPosts();
    const { user } = renderAt(FORM);
    const long = "N".repeat(81);
    await fill(user, { name: long, email: GOOD.email });
    await user.click(sendButton());
    await new Promise((r) => setTimeout(r, 200));
    for (const b of posts.bodies()) expect(b.name.length).toBeLessThanOrEqual(80);
    if (posts.bodies().length === 0) {
      expect(describedBy(nameField())).not.toBe("");
      expect(nameField()).toHaveValue(long);
      expect(emailField()).toHaveValue(GOOD.email);
    }
  });

  it("a valid form sends the name and the email, then says Invitation sent with the email and empties both fields", async () => {
    const posts = watchPosts();
    const { user } = renderAt(FORM);
    await fill(user, GOOD);
    await user.click(sendButton());
    const sent = await screen.findByText(/invitation sent/i);
    let holder: HTMLElement | null = sent;
    for (let i = 0; i < 3 && holder && !(holder.textContent ?? "").includes(GOOD.email); i++) holder = holder.parentElement;
    expect(holder?.textContent).toContain(GOOD.email);
    expect(posts.bodies()).toEqual([GOOD]);
    expect(db.invitations.map((i) => i.email)).toContain(GOOD.email);
    expect(nameField()).toHaveValue("");
    expect(emailField()).toHaveValue("");
  });

  it("a 422 for the email puts the API's message on the Email field, marks it invalid, and keeps both typed values", async () => {
    const { user } = renderAt(FORM);
    await fill(user, { name: GOOD.name, email: "taken@clinic.example" });
    await user.click(sendButton());
    await waitFor(() => expect(emailField()).toHaveAttribute("aria-invalid", "true"));
    expect(describedBy(emailField())).toContain("This email already has a pending invitation.");
    expect(nameField()).not.toHaveAttribute("aria-invalid", "true");
    expect(describedBy(nameField())).not.toContain("pending invitation");
    expect(nameField()).toHaveValue(GOOD.name);
    expect(emailField()).toHaveValue("taken@clinic.example");
    expect(screen.queryByText(/invitation sent/i)).not.toBeInTheDocument();
  });

  it("two submits while the request is waiting send one request", async () => {
    const posts = watchPosts();
    server.use(
      http.post(URL_PATH, async () => {
        await delay(150);
        return HttpResponse.json({ id: "i9" }, { status: 201 });
      }),
    );
    const { user } = renderAt(FORM);
    await fill(user, GOOD);
    await user.dblClick(sendButton());
    await screen.findByText(/invitation sent/i);
    await new Promise((r) => setTimeout(r, 250));
    expect(posts.bodies()).toHaveLength(1);
  });

  it("a failed request is an alert, keeps what was typed, and the form can be sent again", async () => {
    server.use(http.post(URL_PATH, () => new HttpResponse(null, { status: 503 }), { once: true }));
    const posts = watchPosts();
    const { user } = renderAt(FORM);
    await fill(user, GOOD);
    await user.click(sendButton());
    await screen.findByRole("alert");
    expect(screen.queryByText(/invitation sent/i)).not.toBeInTheDocument();
    expect(nameField()).toHaveValue(GOOD.name);
    expect(emailField()).toHaveValue(GOOD.email);
    expect(sendButton()).toBeEnabled();
    await user.click(sendButton());
    expect(await screen.findByText(/invitation sent/i)).toBeInTheDocument();
    expect(posts.bodies()).toHaveLength(2);
  });
});
