import { http, HttpResponse } from "msw";

/**
 * The clinic API as the tests see it: MSW handlers over an in-memory store, answered in-process (no socket). The shapes,
 * statuses and problem bodies are the API's (see the Changes' api-contract.md). `resetDb()` runs after every test
 * (tests/setup.ts); a test may change `db` before it renders, or override one answer with `server.use(...)`.
 */

export interface DoctorRow {
  id: string;
  name: string;
  specialty: string;
}
export interface SlotRow {
  id: string;
  doctorId: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM`, the clinic's local time */
  time: string;
  booked: boolean;
}
export interface BookingRow {
  id: string;
  slotId: string;
}

function seed() {
  return {
    doctors: [
      { id: "d1", name: "Dr. Ana Lima", specialty: "General practice" },
      { id: "d2", name: "Dr. Tomás Okafor", specialty: "Dermatology" },
    ] as DoctorRow[],
    slots: [
      { id: "s1", doctorId: "d1", date: "2030-01-07", time: "09:00", booked: false },
      { id: "s2", doctorId: "d1", date: "2030-01-07", time: "09:30", booked: false },
      { id: "s3", doctorId: "d1", date: "2030-01-07", time: "10:00", booked: true },
      { id: "s4", doctorId: "d1", date: "2030-01-09", time: "14:00", booked: false },
      { id: "s5", doctorId: "d2", date: "2030-01-07", time: "11:00", booked: false },
    ] as SlotRow[],
    /** days with no slot at all are days the doctor does not work (an empty list) */
    days: { d1: ["2030-01-07", "2030-01-08", "2030-01-09"], d2: ["2030-01-07"] } as Record<string, string[]>,
    bookings: [] as BookingRow[],
  };
}

export const db = seed();

export function resetDb(): void {
  Object.assign(db, seed());
}

const problem = (status: number, type: string, title: string) => HttpResponse.json({ type, title, status }, { status, headers: { "content-type": "application/problem+json" } });

export const handlers = [
  http.get("/api/doctors", () => HttpResponse.json(db.doctors)),

  http.get("/api/doctors/:doctorId", ({ params }) => {
    const d = db.doctors.find((x) => x.id === params.doctorId);
    return d ? HttpResponse.json(d) : problem(404, "doctor-not-found", "No such doctor");
  }),

  http.get("/api/doctors/:doctorId/days", ({ params }) => {
    const id = String(params.doctorId);
    if (!db.doctors.some((x) => x.id === id)) return problem(404, "doctor-not-found", "No such doctor");
    return HttpResponse.json((db.days[id] ?? []).map((date) => ({ date, openSlots: db.slots.filter((s) => s.doctorId === id && s.date === date && !s.booked).length })));
  }),

  http.get("/api/doctors/:doctorId/days/:date/slots", ({ params }) => {
    const id = String(params.doctorId);
    if (!db.doctors.some((x) => x.id === id)) return problem(404, "doctor-not-found", "No such doctor");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(params.date))) return problem(400, "invalid-request", "The request is not valid");
    const slots = db.slots.filter((s) => s.doctorId === id && s.date === params.date).sort((a, b) => a.time.localeCompare(b.time));
    return HttpResponse.json(slots.map(({ id: slotId, time, booked }) => ({ id: slotId, time, booked })));
  }),

  http.post("/api/bookings", async ({ request }) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return problem(400, "invalid-request", "The request is not valid");
    }
    const slotId = body && typeof body === "object" ? (body as { slotId?: unknown }).slotId : undefined;
    if (typeof slotId !== "string" || Object.keys(body as object).length !== 1) return problem(400, "invalid-request", "The request is not valid");
    const slot = db.slots.find((s) => s.id === slotId);
    if (!slot) return problem(404, "slot-not-found", "No such slot");
    if (slot.booked) return problem(409, "slot-taken", "The slot is already booked");
    slot.booked = true;
    const booking = { id: `b${db.bookings.length + 1}`, slotId };
    db.bookings.push(booking);
    return HttpResponse.json(booking, { status: 201 });
  }),
];
