---
case: cut-from-the-program-design
covers: [task-interfaces]
---
## Input

Change `reminders` in an existing Next.js app (package.json lists `next`, `react`, `drizzle-orm` and `zod`; no mail
library). Requirement `reminders/send-reminder` has two scenarios: `sends-the-day-before` and `skips-cancelled`.
The approved Program Design:

```text
## File tree
+ lib/reminders/send.ts            picks tomorrow's appointments and sends one email each
+ lib/reminders/email.tsx          the reminder email
+ app/api/cron/reminders/route.ts  the daily cron route
+ tests/reminders/send.test.ts

## Signatures and contracts
// lib/reminders/send.ts
import { Resend } from "resend";
export async function sendReminders(day: string): Promise<{ sent: number; skipped: number }>;
// lib/reminders/email.tsx
export function ReminderEmail(props: { patient: string; startsAt: string }): JSX.Element;
// app/api/cron/reminders/route.ts
export async function GET(req: Request): Promise<Response>; // 200 { sent, skipped } | 401 without the cron secret
```

The Existing System Report says: "`lib/bookings/notify.ts:8-41` sends the booking confirmation through a queue,
with its test `tests/bookings/notify.test.ts:1-30`." `resend` 4.0.1 will be installed.

## Criteria

- must put every path of the Program Design's file tree inside the `touches` of some task
- must copy the signatures of `sendReminders`, `ReminderEmail` and `GET` into a task's `Produces` spelled exactly as in the Program Design, and not rename or add a public name
- must give the task that builds `lib/reminders/send.ts` a `patterns` entry for `lib/bookings/notify.ts:8-41` (and may add its test) with a `why` that says what to imitate
- must add `docs: ["resend@4.0.1 <topic>"]` to the task that sends the email, since no manifest lists `resend`
- must put a human-only check (the email as it looks in a real inbox) in `manual`, and not put there what a test can prove (a cancelled appointment gets no email)
- must own both scenarios with tasks whose `verify` runs the test file
