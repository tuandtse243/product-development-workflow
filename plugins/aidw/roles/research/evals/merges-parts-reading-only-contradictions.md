---
case: merges-parts-reading-only-contradictions
covers: [codebase-research]
---
## Input

The orchestrator asks you to merge the parts of the Existing System Report of a Change to an existing app (a
neighbourhood badminton club's court booking app) into `.aidw/changes/2026-12-01-x/existing-system.md`. You are not
told what the Change is. Write the merged report in your answer. You cannot run anything in this session.

`existing-system/questions.md`

```markdown
## Group 1: HTTP routes (app/api/)

1. How does a request to `app/api/bookings/route.ts` create a booking, and how is that path tested?

## Group 2: data and email (lib/)

2. Which tables does `lib/db.ts` expose, and where are they created?
3. How is email sent, and how is that tested?
4. Which jobs run outside a request, and how are they started?
```

`existing-system/part-1.md` (excerpt)

```markdown
### The route inserts the booking, then sends the email
`createBooking` inserts the row at `lib/bookings.ts:9` and calls `mailer.send` at `lib/bookings.ts:10-14`.

#### Tested by
Tests read: `tests/bookings.test.ts:9-12` checks the email's address, with `mailer` replaced by `vi.mock` (line 2).
```

`existing-system/part-2.md` (excerpt)

```markdown
### One table, `booking`, created by the Prisma migration
`lib/db.ts:3` exports a Prisma client; `prisma/migrations/0001_init/migration.sql:1-8` creates `booking`.

### Email is sent through Resend
`lib/mailer.ts:7` calls `client.emails.send`. The send happens before the insert (`lib/bookings.ts:9`).

#### Tested by
Tests read: none of `lib/mailer.ts` directly.

## Open questions
- Question 4: no scheduler, cron file or queue library found; searched `lib/`, `app/`, `package.json` and
  `vercel.json` for cron, job, queue and schedule.
```

The code at the two citations the parts disagree on, as it is on disk:

`lib/bookings.ts`

```ts
 9   const booking = await db.booking.create({ data: input });
10   await mailer.send({
11     to: input.playerEmail,
12     template: "booking-confirmed",
13     data: { bookingId: booking.id, startsAt: input.startsAt.toISOString() },
14   });
```

## Criteria

- must start with a Summary of five to ten lines, each naming the section it comes from
- must keep the insert before the send (`lib/bookings.ts:9`, then `10-14`), as the code shows, and say that part 2 was corrected on that point
- must order the findings by capability (bookings, data, email), not by part, and merge the two parts' notes on how email is tested into one place
- must list question 4 under a "Not answered" section, with where part 2 looked, and not answer it
- must not claim to have read any code other than the lines where the parts disagree, and must not add a finding that neither part made
- must not propose, recommend or critique: no "should", no fix, and no label such as bug, risk or fragile on the email sent after the insert
