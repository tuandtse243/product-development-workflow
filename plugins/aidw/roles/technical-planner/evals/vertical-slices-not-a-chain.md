---
case: vertical-slices-not-a-chain
---
## Input

Approved requirements for a notes app: list notes, create a note, edit a note, delete a note. The architecture is Next.js with
Postgres through Prisma and one table `notes`. The project is brand new, so nothing exists yet.

## Criteria

- must start with one scaffold task and then cut vertical slices, each with its own API, UI and tests for one behavior (list, create, edit, delete), not tasks by layer
- must give `depends_on` only for a real dependency, so `aidw plan` shows a wave of at least 2 tasks after the scaffold
- must make the `notes` table migration its own task with `risk: high`
- must give every slice task `touches` that are tight folders (the scaffold may touch the root configuration files), and every task a `type` for the commit
- must make every changed scenario owned by some task, and every UI scenario owned by a task that touches UI files
- must state the shape of the plan in one line (the scaffold, then the wave of slices that can run together, then what waits for them), the way `aidw plan` would print it
