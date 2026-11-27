import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { db } from "../msw/handlers";
import { server } from "../msw/server";
import { renderAt } from "../render";

const DAY = "/doctors/d1/days/2030-01-07";
const SLOTS = "/api/doctors/:doctorId/days/:date/slots";

describe("book a slot", () => {
  it("booking/book-a-slot/slots-loading: says the slots are loading until they arrive", async () => {
    renderAt(DAY);
    expect(screen.getByRole("status")).toHaveTextContent(/loading slots/i);
    await screen.findByRole("button", { name: /09:00/ });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("booking/book-a-slot/open-slots-of-a-day: open slots are buttons named by their time, a booked one shows Booked", async () => {
    renderAt(DAY);
    expect(await screen.findByRole("button", { name: "09:00" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "09:30" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /10:00/ })).not.toBeInTheDocument();
    expect(screen.getByText("10:00", { exact: false }).closest("li")).toHaveTextContent("10:00 Booked");
  });

  it("booking/book-a-slot/pick-a-slot: opens a dialog named by the time and the doctor, focus on Confirm", async () => {
    const { user } = renderAt(DAY);
    await user.click(await screen.findByRole("button", { name: "09:00" }));
    const dialog = screen.getByRole("dialog", { name: "Book 09:00 with Dr. Ana Lima" });
    expect(within(dialog).getByRole("button", { name: "Confirm booking" })).toHaveFocus();
  });

  it("booking/book-a-slot/close-without-booking: Escape or Cancel closes it, focus back on the slot, nothing booked", async () => {
    const { user } = renderAt(DAY);
    const slot = await screen.findByRole("button", { name: "09:30" });
    await user.click(slot);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(slot).toHaveFocus();
    await user.click(slot);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(slot).toHaveFocus();
    expect(db.bookings).toEqual([]);
  });

  it("booking/book-a-slot/confirm-the-booking: books the slot, which then shows Booked", async () => {
    const { user } = renderAt(DAY);
    await user.click(await screen.findByRole("button", { name: "09:00" }));
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "09:00" })).not.toBeInTheDocument();
    expect(screen.getByText("09:00", { exact: false }).closest("li")).toHaveTextContent("09:00 Booked");
    expect(db.bookings).toMatchObject([{ slotId: "s1" }]);
  });

  it("booking/book-a-slot/slot-taken-meanwhile: a 409 says the slot was just taken and shows it Booked", async () => {
    db.slots.find((s) => s.id === "s1")!.booked = false;
    const { user } = renderAt(DAY);
    await user.click(await screen.findByRole("button", { name: "09:00" }));
    db.slots.find((s) => s.id === "s1")!.booked = true; // another patient was faster
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Someone has just booked 09:00");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.getByText("09:00", { exact: false }).closest("li")).toHaveTextContent("09:00 Booked");
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("booking/book-a-slot/slots-fail-to-load: an alert with Retry, which loads the slots again", async () => {
    server.use(http.get(SLOTS, () => new HttpResponse(null, { status: 503 }), { once: true }));
    const { user } = renderAt(DAY);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the slots of this day.");
    expect(screen.queryByText(/no open slots/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "09:00" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("booking/book-a-slot/no-slots-on-the-day: says there are no open slots", async () => {
    renderAt("/doctors/d1/days/2030-01-08");
    expect(await screen.findByText("No open slots on this day.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
