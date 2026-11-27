# Data model: book-a-room

Author: database-architect. No schema change: the tables and the index exist (`src/db/schema.sql`).

| table | columns used | notes |
|---|---|---|
| `rooms` | `id`, `team_id` | the room's team is `team_id` |
| `team_members` | `team_id`, `user_id` | a row links a user to a team |
| `bookings` | `id`, `room_id`, `team_id`, `booked_by`, `starts_at`, `status`, `created_at` | `team_id` is the room's team (copied at insert); `booked_by` is the caller; `status` `active` or `cancelled` |

Constraint: `bookings_one_active_per_slot`, a unique index on (`room_id`, `starts_at`) where `status = 'active'`: at
most one active booking per slot.
