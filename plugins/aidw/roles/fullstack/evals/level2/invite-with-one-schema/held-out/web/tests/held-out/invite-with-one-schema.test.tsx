import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backend, signIn } from "../backend";
import { server } from "../msw/server";

/**
 * Held-out tests of the level 2 case invite-with-one-schema: the Team page and its invite dialog, driven through the app's
 * router into the real server (web/tests/backend.ts and web/tests/msw/handlers.ts, restored before grading, forward every
 * /api/* request to the Express app over a PGlite); the requests that leave the app are counted at the network. The last two
 * tests read the source: which files the web entry reaches, and which shared file both halves use.
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
  await t.seed.team("Alpha", { owners: [ana], members: [bo] });
  signIn(who === "owner" ? ana : bo);
  const rows = () => t.db.query<{ name: string; email: string }>("select name, email from invites order by created_at, name");
  return { t, rows };
}

beforeEach(() => vi.resetModules());

/** The POST /api/invites requests that reached the network while a test ran. */
function countInvites() {
  const seen: string[] = [];
  const on = ({ request }: { request: Request }) => {
    if (request.method === "POST" && new URL(request.url).pathname === "/api/invites") seen.push(request.url);
  };
  server.events.on("request:start", on);
  afterEachOff.push(() => server.events.removeListener("request:start", on));
  return seen;
}
const afterEachOff: (() => void)[] = [];
afterEach(() => afterEachOff.splice(0).forEach((f) => f()));

const NAME = /name/i;
const EMAIL = /e-?mail/i;

/** The invite form: the dialog behind an "Invite" button of the Team page, or the form itself when the page shows it. */
async function openForm(user: App["user"]): Promise<HTMLElement> {
  const field0 = () => screen.queryByRole("textbox", { name: NAME });
  const opener = () => screen.queryByRole("button", { name: /invite|add|new/i });
  await waitFor(() => expect(field0() ?? opener()).toBeTruthy());
  if (!field0()) await user.click(opener()!);
  const field = await screen.findByRole("textbox", { name: NAME });
  return field.closest("form") ?? (field.closest("[role=dialog]") as HTMLElement) ?? document.body;
}

/** Sets a value as the browser's input would: user-event types it, or a change event sets a long one (a maxLength would cut typing). */
async function fill(user: App["user"], form: HTMLElement, label: RegExp, value: string, how: "type" | "set" = "type") {
  const field = within(form).getByRole("textbox", { name: label });
  if (how === "set") fireEvent.change(field, { target: { value } });
  else {
    await user.clear(field);
    await user.type(field, value);
  }
}

/** Sends the form: its submit button, or Enter when it has none that says so. */
async function send(user: App["user"], form: HTMLElement) {
  const button = within(form).queryByRole("button", { name: /send|invite|add|submit|save|confirm|create/i });
  if (button) await user.click(button);
  else await user.type(within(form).getByRole("textbox", { name: EMAIL }), "{Enter}");
}

function describedBy(el: HTMLElement): string {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

const closed = () => waitFor(() => expect(screen.queryByRole("textbox", { name: NAME })).not.toBeInTheDocument());

describe("invite a member through the real server (held out)", () => {
  it("an owner types '  Dana White  ' and a valid email and sends: the form closes and the row holds the trimmed name", async () => {
    const { rows } = await world();
    const { user } = await open("/team");
    const form = await openForm(user);
    await fill(user, form, NAME, "  Dana White  ");
    await fill(user, form, EMAIL, "dana@example.test");
    await send(user, form);
    await closed();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await rows()).toEqual([{ name: "Dana White", email: "dana@example.test" }]);
  });

  it("a name of exactly 80 characters is sent and stored", async () => {
    const { rows } = await world();
    const sent = countInvites();
    const { user } = await open("/team");
    const form = await openForm(user);
    await fill(user, form, NAME, "n".repeat(80), "set");
    await fill(user, form, EMAIL, "dana@example.test");
    await send(user, form);
    await closed();
    expect(sent).toHaveLength(1);
    expect((await rows())[0]?.name).toBe("n".repeat(80));
  });

  it("an 81-character name is refused by the form before any request: the name field is aria-invalid with text that says it is too long", async () => {
    const { rows } = await world();
    const sent = countInvites();
    const { user } = await open("/team");
    const form = await openForm(user);
    await fill(user, form, NAME, "n".repeat(81), "set");
    await fill(user, form, EMAIL, "dana@example.test");
    await send(user, form);
    await waitFor(() => expect(screen.getByRole("textbox", { name: NAME })).toHaveAttribute("aria-invalid", "true"));
    expect(describedBy(screen.getByRole("textbox", { name: NAME }))).toMatch(/too long|80|at most|no more than|exceed|limit|shorter|characters/i);
    expect(sent).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it("an email that is not an address is refused by the form before any request: the email field is aria-invalid with text that says so", async () => {
    const { rows } = await world();
    const sent = countInvites();
    const { user } = await open("/team");
    const form = await openForm(user);
    await fill(user, form, NAME, "Dana");
    await fill(user, form, EMAIL, "not-an-email");
    await send(user, form);
    await waitFor(() => expect(screen.getByRole("textbox", { name: EMAIL })).toHaveAttribute("aria-invalid", "true"));
    expect(describedBy(screen.getByRole("textbox", { name: EMAIL }))).toMatch(/valid|invalid|not an?|looks|address|format|email/i);
    expect(sent).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it("after a refused name the person fixes it and the invite goes through", async () => {
    const { rows } = await world();
    const { user } = await open("/team");
    const form = await openForm(user);
    await fill(user, form, NAME, "n".repeat(81), "set");
    await fill(user, form, EMAIL, "dana@example.test");
    await send(user, form);
    await waitFor(() => expect(screen.getByRole("textbox", { name: NAME })).toHaveAttribute("aria-invalid", "true"));
    await fill(user, form, NAME, "Dana");
    await send(user, form);
    await closed();
    expect(await rows()).toEqual([{ name: "Dana", email: "dana@example.test" }]);
  });

  it("a member who is not an owner: the server's 403 is a message that says only owners can invite; nothing is stored", async () => {
    const { rows } = await world("member");
    const { user } = await open("/team");
    const form = await openForm(user);
    await fill(user, form, NAME, "Dana");
    await fill(user, form, EMAIL, "dana@example.test");
    await send(user, form);
    const [message] = await screen.findAllByText(/owner|not allowed|allowed|permit|permission|only|cannot invite|can't invite|forbidden/i);
    expect(message!.textContent).not.toMatch(/something went wrong|try again/i);
    expect(await rows()).toEqual([]);
  });
});

// ---------------------------------------------------------------- what the web app's code reaches

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CODE = /\.(tsx?|jsx?|mts|cts)$/;
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

/** The static imports of a source text: `import x from`, `import "x"`, `export ... from "x"`, `import("x")`; comments left out. */
function specifiers(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const out: string[] = [];
  for (const m of code.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) out.push((m[1] ?? m[2])!);
  return out;
}

/** The files (relative to the project) and the packages the code at `entry` reaches by its imports, type-only imports included. */
function reach(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const todo = [resolve(root, entry)];
  while (todo.length) {
    const file = todo.pop()!;
    const key = relative(root, file);
    if (files.has(key)) continue;
    files.add(key);
    if (!CODE.test(file)) continue;
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      if (!spec.startsWith(".")) {
        packages.add(spec);
        continue;
      }
      const base = resolve(dirname(file), spec);
      const hit = EXTS.map((e) => base + e).find((p) => existsSync(p) && statSync(p).isFile());
      if (hit) todo.push(hit);
    }
  }
  return { files, packages };
}

describe("what the web app's code reaches (held out)", () => {
  it("the web entry's module graph reaches nothing of server/ (no database client, no Express, no PGlite)", () => {
    const { files, packages } = reach("web/main.tsx");
    expect(files.has("web/routes.tsx")).toBe(true);
    expect([...files].filter((f) => f.startsWith("server/"))).toEqual([]);
    expect([...packages].filter((p) => /^(express|@electric-sql\/|pg$|node:)/.test(p))).toEqual([]);
  });

  it("the limit of 80 is written once, in a shared file both halves import, and in no other file the two halves run", () => {
    const web = reach("web/main.tsx").files;
    const api = reach("server/app.ts").files;
    const common = [...web].filter((f) => f.startsWith("shared/") && api.has(f) && !/^shared\/(errors|projects|billing)\.ts$/.test(f));
    expect(common, "a shared file both halves import").not.toEqual([]);
    // The code of a file without comments and string literals, so `// max: 80` or "at most 80 characters" count for nothing.
    const code = (f: string) =>
      readFileSync(join(root, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
        .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
    const LIMIT = /\b80\b/;
    expect(common.some((f) => LIMIT.test(code(f))), "the number 80 in a shared file").toBe(true);
    const elsewhere = [...new Set([...web, ...api])].filter((f) => CODE.test(f) && !f.startsWith("shared/") && LIMIT.test(code(f)));
    expect(elsewhere, "the limit written again outside shared/").toEqual([]);
  });
});
