-- Schema of the tracker. Owned by the database Role: a change here is a migration task of its own.

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index projects_team_id on projects(team_id);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  created_by uuid not null references users(id),
  title text not null check (char_length(title) between 1 and 200),
  due_date date,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index tasks_project_id on tasks(project_id) where deleted_at is null;

-- Mail owed by a write, recorded in the write's transaction and sent after commit by a job (src/jobs/). A sender
-- claims a row until `claimed_until`, sends it, and sets `sent_at`; a failed send raises `attempts`, records
-- `last_error` and sets `next_try_at` later; `failed_at` marks a row given up on.
create table outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  next_try_at timestamptz not null default now(),
  claimed_until timestamptz,
  last_error text,
  failed_at timestamptz
);
create index outbox_due on outbox(next_try_at) where sent_at is null and failed_at is null;

-- Add-ons a team can order (extra storage, priority support). Prices in cents.
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_cents integer not null check (price_cents > 0),
  active boolean not null default true
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  placed_by uuid not null references users(id),
  total_cents integer not null check (total_cents > 0),
  created_at timestamptz not null default now()
);
create index orders_team_id on orders(team_id);

create table order_lines (
  order_id uuid not null references orders(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  product_id uuid not null references products(id),
  quantity integer not null check (quantity between 1 and 99),
  unit_price_cents integer not null check (unit_price_cents > 0),
  primary key (order_id, line_no)
);

-- Invoices of a team, paid with the team's saved card at the payment provider (`customer_ref`). Amounts in cents.
create table invoices (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  number text not null unique,
  amount_due integer not null check (amount_due > 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  customer_ref text not null,
  created_at timestamptz not null default now()
);
create index invoices_team_id on invoices(team_id);

-- A payment of an invoice; an invoice may be paid in parts, so several payments may name one invoice.
create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount integer not null check (amount > 0),
  currency text not null,
  state text not null check (state in ('requested', 'charged', 'declined')),
  provider_ref text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_invoice_id on payments(invoice_id);

-- Idempotency-Keys of writes a client may send again: one row per caller and key, the fingerprint of the request,
-- the record it made (`resource_id`) and, once done, the first response.
create table idempotency_keys (
  caller_id uuid not null references users(id) on delete cascade,
  key text not null,
  fingerprint text not null,
  state text not null check (state in ('in_progress', 'done')),
  resource_id uuid,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (caller_id, key)
);

-- Meeting rooms of a team, booked by the hour: a slot is a room and the hour it starts (`starts_at`, on the hour).
create table rooms (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index rooms_team_id on rooms(team_id);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  booked_by uuid not null references users(id),
  starts_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
-- At most one active booking per slot: two bookings of one slot at once cannot both be stored.
create unique index bookings_one_active_per_slot on bookings(room_id, starts_at) where status = 'active';
