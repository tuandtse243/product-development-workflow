# Data model: place-an-order

Author: database-architect. No schema change: the tables exist (`src/db/schema.sql`).

| table | columns used | notes |
|---|---|---|
| `products` | `id`, `price_cents`, `active` | an inactive product cannot be ordered |
| `team_members` | `team_id`, `user_id` | a row links a user to a team |
| `orders` | `id`, `team_id`, `placed_by`, `total_cents`, `created_at` | `placed_by` is the caller |
| `order_lines` | `order_id`, `line_no`, `product_id`, `quantity`, `unit_price_cents` | `line_no` from 1 in the order of the request; `unit_price_cents` the product's price when ordered |
| `outbox` | `id`, `kind`, `payload`, `sent_at`, `attempts`, `next_try_at`, `claimed_until`, `last_error`, `failed_at` | one row per email owed; `payload` holds ids and values (never a credential); a row is due when `sent_at` and `failed_at` are null and `next_try_at` has passed; `claimed_until` is how long a sender holds a row it took |
| `users` | `id`, `email` | the address of the confirmation |
