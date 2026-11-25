# Domain

- **User**: a person who signs in.
- **Team**: a group of users. A user may be in several teams (`team_members`).
- **Project**: belongs to exactly one team.
- **Task**: a piece of work in a project; it belongs to the project's team and records who created it.

## Rules

- Only members of a team see or change its projects and tasks.
- A task's due date, when set, is today or later (UTC) at the time it is created.
