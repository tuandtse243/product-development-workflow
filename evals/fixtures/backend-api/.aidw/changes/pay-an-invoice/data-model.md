# Data model: pay-an-invoice

Author: database-architect. No schema change: the tables exist (`src/db/schema.sql`).

| table | columns used | notes |
|---|---|---|
| `invoices` | `id`, `team_id`, `currency`, `customer_ref` | `customer_ref` is the team's customer at the provider, whose saved card is charged |
| `team_members` | `team_id`, `user_id` | a row links a user to a team |
| `payments` | `id`, `invoice_id`, `amount`, `currency`, `state`, `provider_ref`, `created_by`, `created_at`, `updated_at` | `state`: `requested` (written before the provider is called), `charged` or `declined`; `provider_ref` is the provider's charge id; no unique constraint on `invoice_id`, an invoice may be paid in parts |
| `idempotency_keys` | `caller_id`, `key`, `fingerprint`, `state`, `resource_id`, `response_status`, `response_body`, `created_at`, `updated_at` | primary key (`caller_id`, `key`); `state` `in_progress` or `done`; `resource_id` the payment the key made; `response_status` and `response_body` the first answer, once done |
