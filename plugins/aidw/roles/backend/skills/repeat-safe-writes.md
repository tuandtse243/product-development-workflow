---
name: repeat-safe-writes
description: Make a write that may arrive twice (a retry, a double submit, an Idempotency-Key the contract names) act once and answer the same way both times.
---

# Writes that may arrive twice

What the contract promises is already written in the shared `api-design-rules`, section "Writes that may be
repeated": the same key with the same body returns the first result, the same key with a different body is `422`,
and a stale version is refused instead of silently overwritten. Read those two lines there; this skill is how the
server keeps that promise. The client side of the same key (generate once per intent, resend unchanged) is in the
`resilient-integration` skill.

## Steps

1. **Use a natural key when the domain has one.** "One order per cart", "one payment per invoice": a unique
   constraint on that column makes the second write a conflict with no key table at all. Use the client's key only
   when there is no such column.
2. **Store the key with what it protects**: the key scoped to the caller (two users may send the same key), a
   fingerprint of the request (method, route, a hash of the normalised body), a state (in progress, done) and, once
   done, the status and body of the first response. Write the key row **in the same transaction as the effect**,
   under a unique constraint on (caller, key): if the effect rolls back, the key does too.
3. **Decide each case the way the contract says**:
   - same key, same fingerprint, done: return the stored status and body, do nothing else;
   - same key, different fingerprint: the contract's refusal (`422` in `api-design-rules`);
   - same key still in progress (a second request while the first runs): the contract's conflict status;
   - key required by the contract and missing: the contract's bad-request status;
   - the request fails validation: store nothing, so a corrected retry with the same key is accepted.
   When the contract names the header but not one of these statuses, ask its author (Consultation); do not pick one.
4. **Decide how long keys live** and say it in your report (a day is common). Expiry is a cleanup job or a query
   filter, not part of the request path.
5. **No table to hold the keys?** Do not add a migration. Ask the data model's author (Consultation) where keys are
   stored; if nothing is planned, report that a `database` task is needed.
6. **Test through the route**: the same request twice gives one effect (count the rows, or the calls to the fake
   provider) and two identical responses; the same key with a changed body is refused and changes nothing; two
   requests with the same key at once give one effect.

## Right and wrong

`POST /payments` with `Idempotency-Key`, contract: `201` first, same response on repeat, `422` on a changed body.

Right: the key row and the payment are one transaction, and the repeat replays the stored answer.

```
tx:
  row = INSERT INTO idem_keys (caller, key, fingerprint, state) VALUES (...)   -- unique (caller, key)
        ON CONFLICT DO NOTHING RETURNING *
  if no row:
    existing = SELECT ... WHERE caller = :c AND key = :k
    if existing.fingerprint != fp -> 422
    if existing.state == 'in_progress' -> 409
    return existing.status, existing.body
  payment = INSERT INTO payments ...
  UPDATE idem_keys SET state = 'done', status = 201, body = :response WHERE ...
commit
test: same request twice -> both 201, same body, one payments row
test: same key, amount changed -> 422, still one payments row
```

Wrong: the key is checked in memory and saved after the effect, so a crash or a parallel request charges twice.

```
if (seenKeys.has(key)) return 200            // per process, lost on restart, status differs from the first
const payment = await createPayment(body)
seenKeys.add(key)                            // a second request in between creates a second payment
```

## Sources

Ideas, not wording: the IETF HTTPAPI draft "The Idempotency-Key HTTP Header Field" (draft 09: fingerprint, `422`,
`409`, `400`, expiry policy); Stripe's API reference on idempotent requests (store the first response, compare the
parameters, prune old keys); aidw's own `api-design-rules` and `resilient-integration`, cited above rather than
repeated. Look at the IETF draft again when it becomes an RFC.
