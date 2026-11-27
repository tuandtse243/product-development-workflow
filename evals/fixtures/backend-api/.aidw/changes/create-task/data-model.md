# Data model: create-task

Author: database-architect. No schema change: the `tasks` table already exists (`src/db/schema.sql`).

| table | columns used | notes |
|---|---|---|
| `projects` | `id`, `team_id` | the project's team is `team_id` |
| `team_members` | `team_id`, `user_id` | a row links a user to a team; primary key `(team_id, user_id)` |
| `tasks` | `id`, `project_id`, `team_id`, `created_by`, `title`, `due_date`, `created_at`, `deleted_at` | `team_id` is the project's team (copied at insert, for team-scoped queries); `created_by` is the caller; `title` is checked 1 to 200 characters by the table; `deleted_at` is null for a live task |

`tasks.team_id` must equal the team of `tasks.project_id`; the code sets it from the project row it read.
