---
name: repeat-safe-writes
description: Make a write that may arrive twice (a retry, a double submit, an Idempotency-Key the contract names) act once and answer the same way both times, whether the effect stays in the database or crosses to a provider.
---

# Writes that may arrive twice

Serves rules B1 and B7. What the contract promises is already written in the shared `api-design-rules`, section
"Writes that may be repeated": the same key with the same body returns the first result, the same key with a
different body is `422`, and a stale version is refused instead of silently overwritten. Read those two lines
there; this skill is how the server keeps that promise. The client side of the same key (generate once per intent,
resend unchanged) is in the `resilient-integration` skill. The key table and both flows in SQL are in
`aidw plugin-path roles/backend/references/idempotency-keys.md`.

## Steps

1. **Use a natural key when the domain has one.** "One order per cart", "one payment per invoice": a unique
   constraint on that column makes the second write a conflict with no key table at all. Use the client's key only
   when there is no such column.
2. **Store the key with what it protects**: the key scoped to the caller (two users may send the same key), a
   fingerprint of the request (method, route template, a hash of the canonical body), a state, and once done the
   status and body of the first response, under a unique constraint on (caller, key).
3. **Choose the flow by where the effect goes.**
   - **(a) The effect is local rows only.** Write the key row and the effect in **one transaction**. A concurrent
     duplicate blocks on the unique index until the first commits, then finds the finished row and replays it, so
     there is no "in progress" answer in this flow. A rollback removes the key with the work, so a failed attempt can
     be retried with the same key.
   - **(b) The effect includes a remote call** (a payment provider, a mail service). A transaction cannot hold it.
     Commit the key row as `in_progress` first (with the intent, "payment requested"). Call the provider passing the
     key, or a key derived from it, as the provider's own idempotency key. Store the response and mark the key done
     in a second transaction. A duplicate that finds `in_progress` gets the contract's `409`. A key stuck in
     `in_progress` past an age threshold is recovered by retrying the call with the same provider key, or by asking
     the provider what happened, never by a fresh call with a new key.
4. **Decide each case the way the contract says**:
   - same key, same fingerprint, done: return the stored status and body, do nothing else;
   - same key, different fingerprint: the contract's refusal (`422` in `api-design-rules`);
   - same key still in progress (flow b only): the contract's `409`;
   - key required by the contract and missing: the contract's `400`;
   - the request fails validation: store nothing, so a corrected retry with the same key is accepted.
   When the contract names the header but not one of these statuses, ask its author (Consultation); do not pick one.
5. **Decide how long keys live** and say it in your report (a day is common). Expiry is a cleanup job or a query
   filter, not part of the request path.
6. **No table to hold the keys?** Do not add a migration. Ask `database-architect` (Consultation) where keys are
   stored; if nothing is planned, report under Owed that a `database` task is needed.
7. **Test through the route**: the same request twice gives one effect (count the rows, or the calls to the fake
   provider) and two identical responses; the same key with a changed body is refused and changes nothing. Flow a:
   two requests with the same key at once give one effect and two identical responses. Flow b: a duplicate while the
   fake provider is held gets `409`, and a key stuck in progress is recovered with the same provider key.

## Right and wrong

`POST /payments` with `Idempotency-Key` (flow b), contract: `201` first, same response on repeat, `422` on a
changed body, `409` while the first is running.

Right: the key is committed before the provider call, the provider gets the same key, the result is stored after.

```
tx1:
  row = INSERT INTO idem_keys (caller, key, fingerprint, state) VALUES (..., 'in_progress')
        ON CONFLICT DO NOTHING RETURNING *
  if no row:
    existing = SELECT ... WHERE caller = :c AND key = :k
    if existing.fingerprint != fp      -> 422
    if existing.state == 'in_progress' -> 409
    return existing.status, existing.body
  INSERT INTO payments (id, state = 'requested') ...
commit
charge = provider.charge(amount, idempotencyKey = "pay-" + key)   -- adapter with a timeout
tx2:
  UPDATE payments SET state = 'charged', provider_ref = charge.id ...
  UPDATE idem_keys SET state = 'done', status = 201, body = :response ...
commit
test: same request twice          -> both 201, same body, provider called once
test: same key, amount changed    -> 422, still one payment
test: duplicate while provider held -> 409
```

Wrong: the key is checked in memory and saved after the effect, so a crash or a parallel request charges twice.

```
if (seenKeys.has(key)) return 200            // per process, lost on restart, status differs from the first
const payment = await provider.charge(body)  // no provider idempotency key
seenKeys.add(key)                            // a second request in between charges again
```

## Sources

Ideas, not wording: the IETF HTTPAPI draft "The Idempotency-Key HTTP Header Field" (draft 09: fingerprint, `422`,
`409`, `400`, expiry policy); Stripe's API reference on idempotent requests (store the first response, compare the
parameters, prune old keys); Brandur Leach's "Implementing Stripe-like Idempotency Keys in Postgres" (recovery
points around a call that leaves the database); aidw's own `api-design-rules` and `resilient-integration`, cited
above rather than repeated. Look at the IETF draft again when it becomes an RFC.
