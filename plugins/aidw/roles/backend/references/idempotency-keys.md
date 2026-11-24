# Storing idempotency keys

Lookup material for the backend Role, read when a route accepts an `Idempotency-Key` or a scenario says a retry must
not act twice. What the client sees (same key and same body returns the first result, a different body is `422`, a
key still running in the cross-boundary flow is `409`) is in `aidw/api-design-rules` and the contract; the procedure is the backend Skill on
repeat-safe writes. This file is the storage behind it. The table is a schema change: if it does not exist, it is a
`database` task: ask `database-architect` (a Consultation), and report it under Owed if nothing is planned.

## The table

```sql
CREATE TABLE idempotency_keys (
  caller_id        text        NOT NULL,  -- the user, tenant or API client from the token, never from the body
  key              text        NOT NULL,  -- the client's Idempotency-Key, length-limited
  fingerprint      text        NOT NULL,  -- hash of method, route template and the canonical body
  state            text        NOT NULL,  -- 'running' | 'done'
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (caller_id, key)
);
```

- **Scope the key by caller.** A key unique across all callers lets one client replay another's response.
- **The fingerprint** decides "same request": hash the parsed, canonical body (sorted keys), not the raw bytes, so
  whitespace does not count as a change.
- **Store the response, not just "seen"**, so a replay returns the same status and body, including the id that was
  created.

## The flow when the effect is local (database only)

One transaction holds the key and the effect:

1. `INSERT ... (state = 'running') ON CONFLICT DO NOTHING RETURNING ...`.
2. Inserted: do the work, `UPDATE` the row to `done` with the response, commit, answer.
3. Not inserted: read the row. Different fingerprint: `422`. `done`: replay the stored response.

A concurrent duplicate does not see `running` here: in PostgreSQL it blocks on the first one's uncommitted insert,
then sees the committed row and replays it, so two concurrent duplicates give one effect. A rollback removes the key with the work, so a failed
attempt can be retried with the same key.

## The flow when the effect crosses a boundary (a payment, an email)

A transaction cannot hold an outside call. Split it into recorded steps:

1. Transaction 1: insert the key as `running` together with the intent ("payment requested"), commit.
2. Call the provider, passing your own idempotency key for that call (the `library/resilient-integration` Skill).
3. Transaction 2: store the result and mark the key `done` with the response. A duplicate that arrives between the
   two transactions finds the key `running` and gets `409`.
4. A row stuck in `running` past a timeout is resolved by a job that asks the provider what happened, never by
   calling it again blind.

## Decisions to state in the report (or find in the contract)

- **What is stored for a failure.** Validation errors (`400`, `422`) are usually not stored, so the client can fix the
  body and retry with the same key; whether a `500` is stored and replayed is a contract choice.
- **How long keys live.** A retention period (24 hours is common) and the job that deletes older rows; after it, the
  same key is a new request.
- **Where the key is required.** A required key that is missing is `400`.

## Sources

IETF draft `draft-ietf-httpapi-idempotency-key-header` (fingerprint, `422`, `409`, `400`, expiry policy); Stripe API
reference, "Idempotent requests" (storing the first response, comparing parameters, pruning keys after 24 hours, not
storing failed validation); Brandur Leach, "Implementing Stripe-like Idempotency Keys in Postgres" (recovery points
for calls that leave the database); PostgreSQL 18 documentation, `INSERT ... ON CONFLICT`. Written for aidw; no text
copied.
