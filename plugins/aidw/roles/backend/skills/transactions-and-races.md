---
name: transactions-and-races
description: Keep a multi-row write whole and make a rule hold when two requests arrive at once (at most one, never below zero, only once) by letting the database arbitrate, with a test that fires both.
---

# Transactions and races

Two kinds of bug look fine in a single-request test. A write that touches several rows stops halfway and leaves
them disagreeing. Two requests read the same value, both decide they may act, and both write. Both are fixed in the
database, not in the code around it.

## Steps

1. **Draw the transaction around the whole business change**: every row or table that must change together is
   written inside one transaction, or none is. Read what you decide on inside it too.
2. **Nothing slow or remote inside it.** No HTTP call, no email, no queue publish, no file upload while the
   transaction is open: it holds locks for as long as the slowest outside service. What must be sent goes after the
   commit (the `effects-after-commit` skill).
3. **Find the rule that must hold under concurrency.** Scenario words give it away: "at most", "only one",
   "cannot go below", "cannot twice", "first come". Write the rule as one sentence the database can check.
4. **Pick the arbiter** and say in your report why it fits:
   - a **unique or partial unique constraint**: one booking per slot, one active subscription per user;
   - a **conditional update** that checks and changes in one statement, then reads the count of rows changed:
     `stock = stock - n WHERE id = ? AND stock >= n`;
   - a **version column** compared on update, for edits that must not overwrite each other;
   - a **row lock** taken when the decision needs several reads (lock in a fixed order to avoid deadlocks).
   A read in code followed by a write in code is never the arbiter, at any isolation level you have not tested.
5. **Map the refusal to the contract**: a unique violation or zero rows changed becomes the contract's conflict
   status and error shape, not a `500`. Catch only that specific database error; let others through.
6. **Test with two requests at once** through the real entry point and a real database: start both before either
   finishes, then assert exactly one succeeded, the other got the conflict status, and the stored state obeys the
   rule. A sequential test of "the second one is refused" does not prove the race is closed.
7. **The arbiter needs a constraint, a column or an index that does not exist?** Do not add it: schema files are
   not in a backend task's Touches. Ask the data model's author (Consultation) whether it is planned and under
   what name; if it is not, report that a `database` task is needed. Do not guess with a code-only lock.

## Right and wrong

Scenario: "a slot can be booked once".

Right: one statement decides, its result is mapped, and the test races two bookings.

```
tx:
  updated = UPDATE slots SET booked_by = :user WHERE id = :slot AND booked_by IS NULL
  if updated == 0 -> raise SlotTaken            # mapped to the contract's 409
  INSERT INTO bookings (slot_id, user_id) ...
commit
then: send confirmation (after commit)

test: two users POST /bookings for the same slot at once
      -> statuses are {201, 409}; exactly one booking row exists
```

Wrong: check in code, write later, and a network call while the transaction holds its locks.

```
tx:
  slot = SELECT * FROM slots WHERE id = :slot
  if slot.booked_by is null:                    # both requests see null
    payment.charge(card)                        # remote call inside the transaction
    UPDATE slots SET booked_by = :user WHERE id = :slot
commit
test: book once, then book again -> 409          # sequential; the race is never exercised
```

## Sources

Ideas, not wording: the PostgreSQL documentation on transaction isolation and explicit locking; the lock and
short-transaction rules of the vendored `supabase/supabase-postgres-best-practices`; the `strong_migrations`
README (ankane) on lock timeouts; the "read-then-write with no guard" and "partial write" checks of the
code-reviewer's `task-review`. Look there again when the project moves to a database with different locking.
