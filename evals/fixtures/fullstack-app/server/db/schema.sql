-- Schema of the team projects app. Owned by the database Role: a change here is a migration task of its own.

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
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

-- A user is an owner or a member of a team; only owners change what the team has.
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
-- A project name is unique in its team, whatever its case.
create unique index projects_team_name on projects(team_id, lower(name));

-- An invitation to join a team, sent by one of its owners to a person who has no account yet.
create table invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  invited_by uuid not null references users(id) on delete cascade,
  email text not null,
  name text not null,
  created_at timestamptz not null default now()
);

-- What a team is billed.
create table invoices (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  number text not null,
  amount_cents integer not null,
  status text not null default 'open' check (status in ('open', 'paid')),
  issued_at timestamptz not null default now()
);
