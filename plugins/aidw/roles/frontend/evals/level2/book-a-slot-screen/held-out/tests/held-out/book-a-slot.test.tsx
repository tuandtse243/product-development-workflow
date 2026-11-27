import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../msw/handlers";
import { server } from "../msw/server";
import { renderAt } from "../render";

/**
 * Held-out tests of the level 2 case book-a-slot-screen: the screen at /doctors/:doctorId/days/:date, through the app's
 * router and the fixture's MSW handlers (tests/msw/handlers.ts, restored before grading). Dr. Ana Lima (d1) has three
 * slots on 2030-01-07: 09:00 and 09:30 open, 10:00 booked.
 */
const DAY = "/doctors/d1/days/2030-01-07";
const SLOTS = "/api/doctors/:doctorId/days/:date/slots";
const TIMES = ["09:00", "09:30", "10:00"];

/** Some element shows the slot's time with "Booked" and no other slot's time. */
function shownBooked(time: string): boolean {
  const others = TIMES.filter((t) => t !== time);
  return screen
    .queryAllByText((_, el) => {
      const text = el?.textContent ?? "";
      return text.includes(time) && /booked/i.test(text) && others.every((o) => !text.includes(o));
    })
    .some(Boolean);
}

/** The slot cannot be picked: no enabled button is named by its time. */
function notPickable(time: string): boolean {
  return screen.queryAllByRole("button", { name: new RegExp(time) }).every((b) => b.hasAttribute("disabled") || b.getAttribute("aria-disabled") === "true");
}

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
});

/** Counts the GET requests for slots from now on. */
function countSlotReads(): { count: () => number } {
  let n = 0;
  const on = ({ request }: { request: Request }) => {
    if (request.method === "GET" && /\/days\/[^/]+\/slots$/.test(new URL(request.url).pathname)) n++;
  };
  server.events.on("request:start", on);
  stop = () => server.events.removeListener("request:start", on);
  return { count: () => n };
}

describe("book a slot (held out)", () => {
  it("every open slot is a button named by its time, and a booked one cannot be picked", async () => {
    renderAt(DAY);
    expect(await screen.findByRole("button", { name: /09:00/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /09:30/ })).toBeEnabled();
    // the name is the time (plus words), never an icon's raw key
    for (const t of ["09:00", "09:30"]) expect(screen.getByRole("button", { name: new RegExp(t) })).not.toHaveAccessibleName(/icon-/);
    expect(notPickable("10:00")).toBe(true);
    expect(shownBooked("10:00")).toBe(true);
  });

  it("picking a slot opens a dialog named by the slot's time and the doctor, with focus inside it", async () => {
    const { user } = renderAt(DAY);
    await user.click(await screen.findByRole("button", { name: /09:00/ }));
    const dialog = await screen.findByRole("dialog", { name: /09:00/ });
    // the doctor may arrive a moment after the dialog opens
    await waitFor(() => expect(dialog).toHaveAccessibleName(/Dr\. Ana Lima/));
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("Escape closes the dialog without booking and puts focus back on the slot that opened it", async () => {
    const { user } = renderAt(DAY);
    await user.click(await screen.findByRole("button", { name: /09:30/ }));
    await screen.findByRole("dialog", { name: /09:30/ });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /09:30/ })).toHaveFocus();
    expect(db.bookings).toEqual([]);
  });

  it("confirming sends the booking and, once answered, the slot shows Booked and cannot be picked again", async () => {
    const { user } = renderAt(DAY);
    await user.click(await screen.findByRole("button", { name: /09:00/ }));
    const dialog = await screen.findByRole("dialog", { name: /09:00/ });
    // the dialog's action button: the one that is neither Cancel nor Close
    const leave = within(dialog).queryAllByRole("button", { name: /^(cancel|close)\b/i });
    const confirm = within(dialog)
      .getAllByRole("button")
      .find((b) => !leave.includes(b));
    await user.click(confirm!);
    await waitFor(() => expect(shownBooked("09:00")).toBe(true));
    expect(notPickable("09:00")).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(db.bookings).toMatchObject([{ slotId: "s1" }]);
    expect(screen.getByRole("button", { name: /09:30/ })).toBeEnabled();
  });

  it("while the slots have not arrived, the screen says they are loading, and the slots replace it", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.get(SLOTS, async () => {
        await gate;
        return HttpResponse.json([
          { id: "s1", time: "09:00", booked: false },
          { id: "s2", time: "09:30", booked: false },
          { id: "s3", time: "10:00", booked: true },
        ]);
      }),
    );
    renderAt(DAY);
    // any form of "loading": a status, a progressbar, a busy region or text that says loading
    const says = () =>
      screen.queryAllByRole("status").length > 0 ||
      screen.queryAllByRole("progressbar").length > 0 ||
      document.querySelector('[aria-busy="true"]') !== null ||
      screen.queryAllByText(/loading|please wait/i).length > 0;
    await waitFor(() => expect(says()).toBe(true));
    expect(screen.queryByRole("button", { name: /09:00/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/no open slots/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    release();
    expect(await screen.findByRole("button", { name: /09:00/ })).toBeEnabled();
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  });

  it("a failed load is an alert with a Retry that loads the slots again, never the empty text", async () => {
    const reads = countSlotReads();
    server.use(http.get(SLOTS, () => new HttpResponse(null, { status: 503 }), { once: true }));
    const { user } = renderAt(DAY);
    await screen.findByRole("alert");
    expect(screen.queryByText(/no open slots/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /09:00/ })).not.toBeInTheDocument();
    const before = reads.count();
    await user.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByRole("button", { name: /09:00/ })).toBeEnabled();
    expect(reads.count()).toBeGreaterThan(before);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a day with no slots shows the empty text and no alert", async () => {
    server.use(http.get(SLOTS, () => HttpResponse.json([])));
    renderAt(DAY);
    expect(await screen.findByText(/no open slots on this day/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a long doctor name stays whole in the dialog's name", async () => {
    const long = `Dr. ${"Maria-Fernanda ".repeat(5)}de Albuquerque e Castro Vasconcelos`;
    db.doctors[0]!.name = long;
    const { user } = renderAt(DAY);
    await user.click(await screen.findByRole("button", { name: /09:00/ }));
    const dialog = await screen.findByRole("dialog", { name: /09:00/ });
    await waitFor(() => expect(dialog).toHaveAccessibleName(expect.stringContaining(long)));
  });
});
