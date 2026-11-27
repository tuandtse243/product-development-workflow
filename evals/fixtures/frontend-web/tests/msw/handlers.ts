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
export interface NoticeRow {
  id: string;
  title: string;
  topic: string;
  expired: boolean;
}
export interface PersonRow {
  id: string;
  name: string;
  title: string;
}
export interface InvitationRow {
  id: string;
  name: string;
  email: string;
}
/** Who is signed in, as `GET /api/session` tells it (null: nobody). */
export interface SessionRow {
  id: string;
  name: string;
  role: "member" | "owner";
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
    notices: [
      { id: "n1", title: "Closed on 1 January", topic: "closures", expired: false },
      { id: "n2", title: "New opening hours", topic: "hours", expired: false },
      { id: "n3", title: "Flu clinic last year", topic: "hours", expired: true },
    ] as NoticeRow[],
    /** the clinic's people, searched by name */
    people: [
      { id: "p1", name: "Abel Ortiz", title: "Nurse" },
      { id: "p2", name: "Abella Cruz", title: "Receptionist" },
      { id: "p3", name: "Abigail Chen", title: "Doctor" },
      { id: "p4", name: "Abe Lindqvist", title: "Pharmacist" },
      { id: "p5", name: "Maria Santos", title: "Nurse" },
    ] as PersonRow[],
    invitations: [{ id: "i1", name: "Taken Person", email: "taken@clinic.example" }] as InvitationRow[],
    messages: [] as { name: string; message: string }[],
    session: null as SessionRow | null,
    billing: { plan: "Clinic Plus", balanceDue: 12900, currency: "EUR", nextInvoice: "2030-02-01" },
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

  http.get("/api/notices", ({ request }) => {
    const topic = new URL(request.url).searchParams.get("topic") ?? "all";
    return HttpResponse.json(db.notices.filter((n) => topic === "all" || n.topic === topic));
  }),

  http.post("/api/messages", async ({ request }) => {
    const body = (await request.json()) as { name?: string; message?: string };
    if (!body.message?.trim()) return problem(422, "validation-failed", "The message is empty");
    db.messages.push({ name: body.name ?? "", message: body.message });
    return HttpResponse.json({ id: `m${db.messages.length}` }, { status: 201 });
  }),

  http.get("/api/people", ({ request }) => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (!q || q.length > 50) return problem(400, "invalid-request", "The request is not valid");
    const found = db.people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 20);
    return HttpResponse.json(found.map(({ id, name, title }) => ({ id, name, title })));
  }),

  http.post("/api/invitations", async ({ request }) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return problem(400, "invalid-request", "The request is not valid");
    }
    if (!body || typeof body !== "object" || Object.keys(body).some((k) => k !== "name" && k !== "email")) return problem(400, "invalid-request", "The request is not valid");
    const { name, email } = body as { name?: unknown; email?: unknown };
    const errors: { field: string; message: string }[] = [];
    if (typeof name !== "string" || !name.trim()) errors.push({ field: "name", message: "Name is required." });
    else if (name.length > 80) errors.push({ field: "name", message: "Name is at most 80 characters." });
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ field: "email", message: "Email is not a valid address." });
    else if (db.invitations.some((i) => i.email.toLowerCase() === email.toLowerCase())) errors.push({ field: "email", message: "This email already has a pending invitation." });
    if (errors.length) return HttpResponse.json({ type: "validation-failed", title: "The invitation is not valid", status: 422, errors }, { status: 422, headers: { "content-type": "application/problem+json" } });
    const invitation = { id: `i${db.invitations.length + 1}`, name: name as string, email: email as string };
    db.invitations.push(invitation);
    return HttpResponse.json({ id: invitation.id }, { status: 201 });
  }),

  http.get("/api/session", () => (db.session ? HttpResponse.json({ user: db.session }) : problem(401, "not-signed-in", "Not signed in"))),

  http.get("/api/billing", () => {
    if (!db.session) return problem(401, "not-signed-in", "Not signed in");
    if (db.session.role !== "owner") return problem(403, "not-an-owner", "Only owners may read the billing");
    return HttpResponse.json(db.billing);
  }),
];
