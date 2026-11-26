---
name: transactions-and-races
description: Keep a multi-row write whole and make a rule hold when two requests arrive at once (at most one, never below zero, only once) by letting the database arbitrate, with a test that really races.
---

# Transactions and races

Serves rules B7, B8 and B15. Two kinds of bug look fine in a single-request test. A write that touches several rows
stops halfway and leaves them disagreeing. Two requests read the same value, both decide they may act, and both
write. Both are fixed in the database, not in the code around it. Lookup: the errors each database raises and how
to map them are in `aidw plugin-path roles/backend/references/database-conflicts.md`.

## Steps

1. **Draw the transaction around the whole business change**: every row or table that must change together is
   written inside one transaction, or none is. Read what you decide on inside it too.
2. **Nothing slow or remote inside it.** No HTTP call, no email, no queue publish, no file upload while the
   transaction is open: it holds locks for as long as the slowest outside service. What must be sent goes after the
   commit (the `effects-after-commit` skill). Set a lock or statement timeout so a stuck lock fails fast instead of
   piling up requests.
3. **Find the rule that must hold under concurrency.** Scenario words give it away: "at most", "only one",
   "cannot go below", "cannot twice", "first come". Write the rule as one sentence the database can check.
4. **Pick the arbiter** and say in your report why it fits:
   - a **unique or partial unique constraint**: one booking per slot, one active subscription per user;
   - a **conditional update** that checks and changes in one statement, then reads the count of rows changed:
     `stock = stock - n WHERE id = ? AND stock >= n`;
   - a **version column** compared on update, for edits that must not overwrite each other;
   - a **row lock** taken when the decision needs several reads (lock in a fixed order to avoid deadlocks);
   - the **serializable** isolation level only together with a retry of the whole transaction on a serialization
     failure; without the retry it turns races into `500`s.
   A read in code followed by a write in code is never the arbiter.
5. **Map the refusal to the contract**: a unique violation or zero rows changed becomes the contract's conflict
   status and error shape, not a `500`. Catch only that specific database error; let others through.
6. **Test a real race** through the real entry point and a real database, each request on its own connection (not
   inside one test transaction that is rolled back at the end, which serialises everything). Either fire N requests
   at once (10 is enough) or hold the first inside its transaction with a barrier until the second has started.
   Assert exactly one succeeded, the rest got the conflict status, and the stored state obeys the rule. A sequential
   "the second one is refused" does not prove the race is closed.
7. **The arbiter needs a constraint, a column or an index that does not exist?** Do not add it: schema files are
   not in a backend task's Touches (B15). Ask `database-architect` (Consultation) whether it is planned and under
   what name; if it is not, report under Owed that a `database` task is needed. Do not guess with a code-only lock.

## Right and wrong

Scenario: "a slot can be booked once".

Right: one statement decides, its result is mapped, and the test races ten bookings on separate connections.

```
tx:
  updated = UPDATE slots SET booked_by = :user WHERE id = :slot AND booked_by IS NULL
  if updated == 0 -> raise SlotTaken            # mapped to the contract's 409
  INSERT INTO bookings (slot_id, user_id) ...
commit
then: send confirmation (after commit)

test: ten users POST /bookings for the same slot at once, each on its own connection
      -> one 201, nine 409; exactly one booking row exists
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
