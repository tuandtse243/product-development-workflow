---
name: effects-after-commit
description: When a write must also cause something outside the database (an email, an event, a job, a call to another service), record what is owed in the same transaction and send it after the commit, at least once.
---

# Effects after the commit

Serves rules B9 and B12. A business change and the message about it can disagree in two ways: the email went out
but the order rolled back, or the order was saved but the process died before the email. Sending inside the
transaction causes the first; sending after it with no record causes the second. Record the debt with the change;
pay it after.

## Steps

1. **Never send inside the transaction, and never send first and save second.** The send is not part of the
   business change; the record that it is owed is.
2. **Record what is owed in the same transaction**: a row in the project's outbox or job table with the event
   type, the payload the receiver needs (ids and values, never a credential), and a unique id for the effect.
   The business change and that row commit together or not at all.
3. **Send from that row, with no transaction open during the send**: a worker, relay or scheduled job first claims
   pending rows in one statement (or one short transaction) that commits at once: it sets a lease on them
   (`claimed_until = now() + lease`), choosing them with `FOR UPDATE SKIP LOCKED` so two workers never take the same
   one. The lease, not a held lock, keeps two rounds apart, and a row whose lease ran out (its worker died) is taken
   again. Then it sends each row, and then marks it sent, or records the failure, in a statement of its own. Never
   hold a transaction, its locks and its connection across the provider call. A failed send is retried later with
   backoff; after N failures the row is marked failed for an operator to look at, not retried forever. Use the
   project's existing queue or job runner; do not add a new one. The call to the provider goes through an adapter
   with an explicit timeout, shorter than the lease, that the tests replace with a fake (the `external-api` and
   `resilient-integration` skills).
4. **Delivery is at least once.** A crash after the send and before "mark sent" sends again (once the lease runs out). Pass the effect's
   unique id as the provider's idempotency key, or make the receiver ignore an id it has seen.
5. **No outbox, job table or queue in the project?** Do not invent one, and do not add a migration for it. Ask the
   architecture's author (Consultation) which mechanism the project uses. If the answer is "an after-commit hook,
   nothing durable", use the framework's after-commit hook and write in your report what is lost on a crash
   between the commit and the send.
6. **Test the failure, not only the success.** Write all three tests; each catches a different bug:
   - the provider fails: the business change is still saved and the effect is still owed;
   - the business change fails (make an insert in it throw): nothing is sent and **no owed row exists**. This
     is the test that proves the row is in the same transaction, so do not skip it;
   - the sender runs twice: the provider is called once per effect.

## Right and wrong

"Placing an order sends a confirmation email."

Right: the order and the owed email commit together; the sender is a separate step that can retry.

```
tx:
  order = INSERT INTO orders ...
  INSERT INTO outbox (id, type, payload) VALUES (:uuid, 'order.confirmation', {orderId, email})
commit
-- later, the project's job runner; the claim is one statement and commits at once:
rows = UPDATE outbox SET claimed_until = now() + interval '60 seconds'
       WHERE id IN (SELECT id FROM outbox
                    WHERE state = 'pending' AND next_try_at <= now()
                      AND (claimed_until IS NULL OR claimed_until < now())
                    ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
       RETURNING id, payload, attempts
for row in rows:                                      -- no transaction open from here on
  mailer.send(row.payload, idempotencyKey = row.id, timeoutMs = 10000)
  UPDATE outbox SET state = 'sent', claimed_until = NULL WHERE id = row.id
  (on failure: attempts + 1, next_try_at later, claimed_until = NULL; failed after 8 attempts)

test: mailer fake fails      -> order saved, outbox row still pending
test: order insert fails     -> no order, no outbox row, mailer not called
test: run the sender twice   -> mailer called once for the order
```

Wrong: the email is sent from inside the transaction, so a rollback after it leaves a confirmation for an order
that does not exist, and a slow mail server holds the order's locks.

```
tx:
  order = INSERT INTO orders ...
  await mailer.send(confirmation(order))        -- remote call inside the transaction
  INSERT INTO order_items ...                   -- fails: rollback, but the email is gone
commit
```

Wrong too: the sender keeps its claim transaction open around the send, so every send holds row locks and a
connection for as long as the mail server takes, and a slow provider blocks other work.

```
tx:
  rows = SELECT ... FROM outbox WHERE state = 'pending' ... FOR UPDATE SKIP LOCKED
  for row in rows:
    mailer.send(row.payload, idempotencyKey = row.id)   -- remote call while the locks are held
    UPDATE outbox SET state = 'sent' WHERE id = row.id
commit
```

## Sources

Ideas, not wording: the "Transactional outbox" and "Idempotent consumer" patterns described by Chris Richardson
on microservices.io; the retry and timeout guidance of the AWS Builders' Library; the `SKIP LOCKED` clause in the
PostgreSQL documentation on `SELECT`; aidw's `resilient-integration` for the provider side. Look there again when
the project adopts a message broker.
