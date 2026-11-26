---
case: describes-the-code-without-proposing
covers: [codebase-research]
---
## Input

The orchestrator asks you to write part 1 of the Existing System Report of a Change to an existing app (a
neighbourhood badminton club's court booking app). You are not told what the Change is. Your group has one question:

> How is a court booking created today, from the HTTP request to the confirmation email, and how is that path
> tested?

The repository is small; these are all the files that matter, with their line numbers. `package.json` has the script
`"test": "vitest run"`. You cannot run anything in this session.

`app/api/bookings/route.ts`

```ts
 1 import { createBooking } from "@/lib/bookings";
 2
 3 export async function POST(req: Request) {
 4   const body = await req.json();
 5   try {
 6     const booking = await createBooking({ ...body, startsAt: new Date(body.startsAt) });
 7     return Response.json(booking, { status: 201 });
 8   } catch (e) {
 9     return Response.json({ error: (e as Error).message }, { status: 409 });
10   }
11 }
```

`lib/bookings.ts`

```ts
 1 import { db } from "./db";
 2 import { mailer } from "./mailer";
 3
 4 export interface NewBooking { courtId: string; playerEmail: string; startsAt: Date }
 5
 6 export async function createBooking(input: NewBooking) {
 7   const clash = await db.booking.findFirst({ where: { courtId: input.courtId, startsAt: input.startsAt } });
 8   if (clash) throw new Error("slot taken");
 9   const booking = await db.booking.create({ data: input });
10   await mailer.send({
11     to: input.playerEmail,
12     template: "booking-confirmed",
13     data: { bookingId: booking.id, startsAt: input.startsAt.toISOString() },
14   });
15   return booking;
16 }
```

`lib/mailer.ts`

```ts
1 import { Resend } from "resend";
2
3 const client = new Resend(process.env.RESEND_API_KEY);
4
5 export const mailer = {
6   async send(msg: { to: string; template: string; data: Record<string, string> }) {
7     await client.emails.send({ from: "club@example.com", to: msg.to, subject: msg.template, html: JSON.stringify(msg.data) });
8   },
9 };
```

`tests/bookings.test.ts`

```ts
 1 import { beforeEach, describe, expect, it, vi } from "vitest";
 2 vi.mock("@/lib/mailer", () => ({ mailer: { send: vi.fn() } }));
 3 import { mailer } from "@/lib/mailer";
 4 import { createBooking } from "@/lib/bookings";
 5 import { resetDb } from "./helpers/db";
 6
 7 describe("createBooking", () => {
 8   beforeEach(resetDb);
 9   it("sends the confirmation to the player", async () => {
10     await createBooking({ courtId: "c1", playerEmail: "a@b.c", startsAt: new Date("2026-12-01T18:00:00Z") });
11     expect(mailer.send).toHaveBeenCalledWith(expect.objectContaining({ to: "a@b.c", template: "booking-confirmed" }));
12   });
13   it("refuses a slot that is taken", async () => {
14     const slot = { courtId: "c1", playerEmail: "a@b.c", startsAt: new Date("2026-12-01T18:00:00Z") };
15     await createBooking(slot);
16     await expect(createBooking({ ...slot, playerEmail: "d@e.f" })).rejects.toThrow("slot taken");
17   });
18 });
```

`tests/helpers/db.ts`

```ts
1 import { db } from "@/lib/db";
2
3 export async function resetDb() {
4   await db.booking.deleteMany();
5 }
```

## Criteria

- must give a file and line (or line range) for every claim about the code, such as the insert at `lib/bookings.ts:9` and the send at `lib/bookings.ts:10-14`
- must describe the path in order: the route reads the body and calls `createBooking` (`route.ts:4-6`), the slot is looked up and a taken slot throws (`bookings.ts:7-8`), the booking is inserted (`bookings.ts:9`), then the email is sent through Resend (`bookings.ts:10-14`, `mailer.ts:7`), and the route answers `201` (`route.ts:7`)
- must state as a fact that the route answers every error from `createBooking` with `409` and the error's message (`route.ts:8-10`), which includes an error from the email send after the booking was inserted
- must say the path is tested in `tests/bookings.test.ts` with the mailer replaced by `vi.mock` (line 2) and the table emptied by `resetDb` (`tests/helpers/db.ts:3-5`), name its two cases, and say as a fact that no test calls the route and none makes the email send fail
- must keep the tests read apart from the checks run, record that no check was run, and not claim that any test passes
- must use finding headings that state what is true, not topic names such as "Booking flow"
- must not propose, recommend or critique: no "should" or "consider", no fix, and no label such as bug, race, risk, fragile or problem on the check-then-insert or on the email sent after the insert
