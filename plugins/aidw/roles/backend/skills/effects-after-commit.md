---
name: effects-after-commit
description: When a write must also cause something outside the database (an email, an event, a job, a call to another service), record what is owed in the same transaction and send it after the commit, at least once.
---

# Effects after the commit

A business change and the message about it can disagree in two ways: the email went out but the order rolled back,
or the order was saved but the process died before the email. Sending inside the transaction causes the first;
sending after it with no record causes the second. Record the debt with the change; pay it after.

## Steps

1. **Never send inside the transaction, and never send first and save second.** The send is not part of the
   business change; the record that it is owed is.
2. **Record what is owed in the same transaction**: a row in the project's outbox or job table with the event
   type, the payload the receiver needs (ids and values, never a credential), and a unique id for the effect.
   The business change and that row commit together or not at all.
3. **Send from that row**: a worker, relay or scheduled job reads pending rows, sends, and marks them sent. Use
   the project's existing queue or job runner; do not add a new one. The call to the provider itself goes through
   an adapter with a timeout (the `external-api` and `resilient-integration` skills).
4. **Delivery is at least once.** A crash after the send and before "mark sent" sends again. Pass the effect's
   unique id as the provider's idempotency key, or make the receiver ignore an id it has seen.
5. **No outbox, job table or queue in the project?** Do not invent one, and do not add a migration for it. Ask the
   architecture's author (Consultation) which mechanism the project uses. If the answer is "an after-commit hook,
   nothing durable", use the framework's after-commit hook and write in your report what is lost on a crash
   between the commit and the send.
6. **Test the failure, not only the success**: the provider fails and the business change is still saved with
   the effect still owed; the business change fails and nothing is sent or owed; a retry of the sender calls the
   provider once per effect.

## Right and wrong

"Placing an order sends a confirmation email."

Right: the order and the owed email commit together; the sender is a separate step that can retry.

```
tx:
  order = INSERT INTO orders ...
  INSERT INTO outbox (id, type, payload) VALUES (:uuid, 'order.confirmation', {orderId, email})
commit
-- later, the project's job runner:
for row in pending outbox rows:
  mailer.send(row.payload, idempotencyKey = row.id)   -- adapter with a timeout
  mark row sent

test: mailer fake fails      -> order saved, outbox row still pending
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

## Sources

Ideas, not wording: the "Transactional outbox" and "Idempotent consumer" patterns described by Chris Richardson
on microservices.io; the retry and timeout guidance of the AWS Builders' Library; aidw's `resilient-integration`
for the provider side. Look there again when the project adopts a message broker.
