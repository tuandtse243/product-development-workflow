import { screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../msw/handlers";
import { server } from "../msw/server";
import { renderAt } from "../render";

/**
 * Held-out tests of the level 2 case people-search: the screen at /people, through the app's router and the fixture's
 * MSW handlers (tests/msw/handlers.ts, restored before grading). The clinic's people (db.people): Abel Ortiz, Abella
 * Cruz, Abigail Chen, Abe Lindqvist, Maria Santos. "ab" matches the first four, "abe" the first, second and fourth.
 * Real timers; the answers are held back for a few hundred milliseconds with MSW's delay.
 */
const PEOPLE = "/api/people";
const SLOW = 300;
const FAST = 20;

/** The search box: the one control of the screen that takes text. */
function box(): HTMLElement {
  return screen.queryByRole("searchbox") ?? screen.getByRole("textbox");
}

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
});

/** Puts the whole text in the box at once: one change, so one request. */
async function enter(user: { click: (el: Element) => Promise<void>; paste: (text: string) => Promise<void> }, text: string) {
  await user.click(box());
  await user.paste(text);
}

/** Counts the GET requests for people from now on. */
function countReads(): { count: () => number } {
  let n = 0;
  const on = ({ request }: { request: Request }) => {
    if (request.method === "GET" && new URL(request.url).pathname === PEOPLE) n++;
  };
  server.events.on("request:start", on);
  stop = () => server.events.removeListener("request:start", on);
  return { count: () => n };
}

/** An answer for a text of the fixture's people, after `ms[q]` milliseconds (SLOW unless the text is listed). */
function answerAfter(ms: Record<string, number>) {
  return http.get(PEOPLE, async ({ request }) => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
    await delay(ms[q] ?? SLOW);
    return HttpResponse.json(db.people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map(({ id, name, title }) => ({ id, name, title })));
  });
}

/** The smallest element that holds the person's name and title and no other person's name. */
function rowOf(name: string, title: string): HTMLElement | null {
  const others = db.people.map((p) => p.name).filter((n) => n !== name);
  let el: HTMLElement | null = screen.queryByText(new RegExp(name))?.closest("*") ?? null;
  while (el && !(el.textContent ?? "").includes(title)) el = el.parentElement;
  return el && others.every((o) => !(el!.textContent ?? "").includes(o)) ? el : null;
}

const says = () =>
  screen.queryAllByRole("status").length > 0 ||
  screen.queryAllByRole("progressbar").length > 0 ||
  document.querySelector('[aria-busy="true"]') !== null ||
  screen.queryAllByText(/searching|loading|please wait/i).length > 0;

describe("search people (held out)", () => {
  it("with nothing typed the screen says to type a name, and sends no request", async () => {
    const reads = countReads();
    renderAt("/people");
    expect(await screen.findByText(/type a name to search/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 150));
    expect(reads.count()).toBe(0);
  });

  it("each match is listed with the name and the title", async () => {
    const { user } = renderAt("/people");
    await enter(user, "abe");
    await screen.findByText(/Abel Ortiz/);
    expect(rowOf("Abel Ortiz", "Nurse")).not.toBeNull();
    expect(rowOf("Abella Cruz", "Receptionist")).not.toBeNull();
    expect(rowOf("Abe Lindqvist", "Pharmacist")).not.toBeNull();
    expect(screen.queryByText(/Abigail Chen/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Maria Santos/)).not.toBeInTheDocument();
  });

  it("while the answer has not arrived the screen says it is searching, and the people replace it", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.get(PEOPLE, async () => {
        await gate;
        return HttpResponse.json([{ id: "p1", name: "Abel Ortiz", title: "Nurse" }]);
      }),
    );
    const { user } = renderAt("/people");
    await enter(user, "abel");
    await waitFor(() => expect(says()).toBe(true));
    expect(screen.queryByText(/Abel Ortiz/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no one matches/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    release();
    expect(await screen.findByText(/Abel Ortiz/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByRole("progressbar")).toHaveLength(0));
  });

  it("an earlier text's slow answer, arriving after the latest text's, is never shown", async () => {
    server.use(answerAfter({ abe: FAST }));
    const { user } = renderAt("/people");
    await user.type(box(), "ab");
    await user.type(box(), "e");
    await screen.findByText(/Abel Ortiz/);
    // let every slow answer (to "a" and "ab") arrive
    await new Promise((r) => setTimeout(r, SLOW + 250));
    expect(screen.getByText(/Abe Lindqvist/)).toBeInTheDocument();
    expect(screen.queryByText(/Abigail Chen/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Maria Santos/)).not.toBeInTheDocument();
    expect(box()).toHaveValue("abe");
  });

  it("emptying the box while an answer is on its way shows the first state again, never the late answer, and sends no request", async () => {
    server.use(answerAfter({}));
    const { user } = renderAt("/people");
    await user.type(box(), "ab");
    const reads = countReads();
    await user.clear(box());
    expect(await screen.findByText(/type a name to search/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, SLOW + 250));
    expect(screen.queryByText(/Abel Ortiz|Abigail Chen|Abella Cruz|Abe Lindqvist/)).not.toBeInTheDocument();
    expect(screen.getByText(/type a name to search/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(reads.count()).toBe(0);
  });

  it("when nobody matches the screen says so with the text typed, and shows no alert", async () => {
    const { user } = renderAt("/people");
    await enter(user, "zzq");
    expect(await screen.findByText(/no one matches/i)).toHaveTextContent(/zzq/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a failed search is an alert with a Retry that searches the same text again, never the no-match text", async () => {
    server.use(http.get(PEOPLE, () => new HttpResponse(null, { status: 503 }), { once: true }));
    const reads = countReads();
    const { user } = renderAt("/people");
    await enter(user, "abel");
    await screen.findByRole("alert");
    expect(screen.queryByText(/no one matches/i)).not.toBeInTheDocument();
    const before = reads.count();
    await user.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByText(/Abel Ortiz/)).toBeInTheDocument();
    expect(reads.count()).toBeGreaterThan(before);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
