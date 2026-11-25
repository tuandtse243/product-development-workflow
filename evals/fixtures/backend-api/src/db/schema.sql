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

-- Mail owed by a write, recorded in the write's transaction and sent after commit.
create table outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0
);
