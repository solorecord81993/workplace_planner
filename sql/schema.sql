-- ============================================================================
-- Workplace Planner — schema for Vercel Postgres (Neon)
-- Run this once against the new database (Vercel dashboard → Storage →
-- your Postgres db → Query, or `psql "$POSTGRES_URL" -f sql/schema.sql`)
--
-- Data retention design:
--   * `schedule.date` is only ever written within [today-3mo, today+3mo] —
--     enforced in api/rpc/[name].js on every save, not just here.
--   * api/cron/cleanup.js (Vercel Cron, monthly) deletes schedule rows older
--     than 3 months and expired sessions, so storage never grows unbounded.
-- ============================================================================

create extension if not exists pgcrypto; -- for gen_random_uuid()

create table if not exists users (
  id        text primary key default gen_random_uuid()::text,
  username  text not null unique,
  name      text not null default '',
  role      text not null default 'user' check (role in ('user','admin')),
  pw_hash   text not null default '',   -- bcrypt hash; '' means not set yet
  needs_pw  boolean not null default true
);

create table if not exists sessions (
  token      text primary key,
  user_id    text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
create index if not exists sessions_user_id_idx on sessions(user_id);

create table if not exists locations (
  id         text primary key,
  name       text not null,
  icon       text not null default '📍',
  color      text not null default '#888888',
  sort_order int  not null default 99
);

create table if not exists holidays (
  id   text primary key default gen_random_uuid()::text,
  date date not null unique,
  name text not null
);

create table if not exists schedule (
  user_id     text not null references users(id) on delete cascade,
  date        date not null,
  location_id text references locations(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, date)
);
create index if not exists schedule_date_idx on schedule(date);

-- ---------------------------------------------------------------------------
-- Seed: first admin account so you're never locked out.
-- Username: admin | needs_pw = true → set the password from the app's
-- "ตั้งรหัสผ่านครั้งแรก" tab on first visit.
-- ---------------------------------------------------------------------------
insert into users (username, name, role, needs_pw)
values ('admin', 'ผู้ดูแลระบบ', 'admin', true)
on conflict (username) do nothing;

-- A few starter locations, edit/delete freely from the app later.
insert into locations (id, name, icon, color, sort_order) values
  ('loc_office', 'เข้าออฟฟิศ', '🏢', '#7c3aed', 1),
  ('loc_wfh',    'Work from Home', '🏠', '#2563eb', 2),
  ('loc_leave',  'ลาหยุด', '📅', '#dc2626', 3)
on conflict (id) do nothing;
