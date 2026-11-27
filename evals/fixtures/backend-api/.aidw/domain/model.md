# Domain

- **User**: a person who signs in.
- **Team**: a group of users. A user may be in several teams (`team_members`).
- **Project**: belongs to exactly one team.
- **Task**: a piece of work in a project; it belongs to the project's team and records who created it.
- **Product**: an add-on a team can order, at a price in cents.
- **Order**: what a member of a team ordered for it: one or more lines of a product and a quantity, at the product's
  price when ordered.
- **Invoice**: an amount a team owes, paid with the team's saved card at the payment provider; it may be paid in parts.
- **Payment**: one charge of the team's card for an invoice.
- **Room**: a meeting room of a team.
- **Booking**: a room booked by a member for one hour, from `starts_at` (on the hour); active or cancelled.

## Rules

- Only members of a team see or change its projects, tasks, orders, invoices and rooms.
- A task's due date, when set, is today or later (UTC) at the time it is created.
- A slot (a room and the hour it starts) has at most one active booking.
- A card is charged once per payment the client asked for, however often the request is sent again.
