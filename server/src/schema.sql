create table if not exists users (
  id text primary key,
  email text not null,
  lower_email text not null unique,
  display_name text,
  password_hash text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists devices (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  device_id text not null,
  device_name text not null,
  token_hash text not null unique,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, device_id)
);

create table if not exists translation_usage_daily (
  user_id text not null references users(id) on delete cascade,
  day date not null,
  request_count integer not null default 0,
  character_count integer not null default 0,
  failure_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(user_id, day)
);

create table if not exists audit_events (
  id text primary key,
  user_id text references users(id) on delete set null,
  device_id text references devices(id) on delete set null,
  event_type text not null,
  status text not null,
  error_code text,
  latency_ms integer,
  character_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_user_created_idx on audit_events(user_id, created_at desc);
create index if not exists devices_user_idx on devices(user_id);
