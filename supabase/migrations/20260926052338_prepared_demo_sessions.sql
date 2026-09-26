-- Prepared, synthetic pitch journey only. These tables contain no customer jobs.
-- No Data API grants or browser RLS policies: the Chappe demo Edge Function is
-- the sole reader/writer and uses the server-side service credential.
create table public.demo_sessions (
  id uuid primary key default gen_random_uuid(),
  engineer_token_hash text not null check (engineer_token_hash ~ '^[0-9a-f]{64}$'),
  guide_status text not null default 'draft' check (guide_status in ('draft','approved')),
  guide_text text not null default 'B2: target internal angle 90 degrees; signed fold rotation -90 degrees. Confirm the return flange orientation against drawing A and the reviewed model before proceeding.' check (char_length(guide_text) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
create table public.demo_issues (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  operation_id text not null check (operation_id in ('B2')),
  kind text not null check (kind in ('question','flag')),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  status text not null default 'pending' check (status in ('pending','answered')),
  answer text check (answer is null or char_length(btrim(answer)) between 1 and 1000),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  constraint demo_answer_state check ((status='pending' and answer is null and answered_at is null) or (status='answered' and answer is not null and answered_at is not null))
);
create index demo_issues_session_created_idx on public.demo_issues(session_id, created_at desc);
alter table public.demo_sessions enable row level security;
alter table public.demo_issues enable row level security;
revoke all on public.demo_sessions, public.demo_issues from anon, authenticated;
comment on table public.demo_sessions is 'Ephemeral prepared Chappe pitch demonstration; no customer job data. Server-only access.';
comment on table public.demo_issues is 'Ephemeral prepared Chappe pitch feedback; server-only access and engineer capability gate.';
