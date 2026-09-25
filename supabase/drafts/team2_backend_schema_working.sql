-- Generated with `supabase migration new team2_backend_schema`.
-- This migration has not been applied to any database. Review and test against
-- a dedicated local/development Supabase project before deployment.
--
-- Contract: SkunkWorks DTO/API vocabulary v1.0.
-- Target: a dedicated development Supabase project only. Never apply to an
-- unrelated or inactive personal project.
--
-- Privileged mutation flows are server-only. The service key must never reach
-- the browser; API routes must resolve the signed-in user with auth.getUser(),
-- check membership/role from workspace_members, validate DTOs and expected
-- versions, then perform the transaction. Release visitors have no direct
-- PostgREST or Storage object policy; API endpoints validate their hashed,
-- link-bound session and stream/download only assets authorized for that
-- release.

create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Member' check (length(btrim(display_name)) > 0),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('admin', 'designer', 'fabricator')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  unique (workspace_id, id)
);
create index workspace_members_user_active_idx
  on public.workspace_members (user_id, workspace_id) where status = 'active';

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  role text not null check (role in ('designer', 'fabricator')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_by uuid references auth.users(id) on delete restrict,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at),
  check ((redeemed_by is null) = (redeemed_at is null))
);
create index workspace_invites_workspace_expiry_idx
  on public.workspace_invites (workspace_id, expires_at);

create table public.workshops (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  current_version integer not null default 1 check (current_version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);

-- The profile JSON is immutable. Confirmation is a separate append-only row so
-- confirming a snapshot never rewrites the snapshot that a job selected.
create table public.workshop_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  workshop_id uuid not null,
  version integer not null check (version > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workshop_id, version),
  unique (workspace_id, workshop_id, id),
  unique (workspace_id, id),
  foreign key (workspace_id, workshop_id)
    references public.workshops(workspace_id, id) on delete restrict
);
create index workshop_versions_lookup_idx
  on public.workshop_versions (workspace_id, workshop_id, version desc);

create table public.workshop_snapshot_confirmations (
  snapshot_id uuid primary key,
  workspace_id uuid not null,
  workshop_id uuid not null,
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  foreign key (workspace_id, workshop_id, snapshot_id)
    references public.workshop_versions(workspace_id, workshop_id, id) on delete restrict
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  title text not null check (length(btrim(title)) > 0),
  part_number text not null check (length(btrim(part_number)) > 0),
  part_family text not null check (length(btrim(part_family)) > 0),
  version integer not null default 1 check (version > 0),
  workshop_snapshot_id uuid,
  machine_id uuid,
  current_draft_id uuid,
  latest_release_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  check ((workshop_snapshot_id is null) = (machine_id is null)),
  foreign key (workspace_id, workshop_snapshot_id)
    references public.workshop_versions(workspace_id, id) on delete restrict
);
create index jobs_workspace_created_idx
  on public.jobs (workspace_id, created_at desc);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  job_id uuid not null,
  release_id uuid,
  kind text not null check (kind in ('drawing_pdf', 'model_glb', 'bend_manifest', 'issue_photo')),
  filename text not null check (length(btrim(filename)) > 0),
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  version integer not null default 1 check (version > 0),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  drawing_revision text,
  storage_key text not null unique,
  uploaded_by_user_id uuid references auth.users(id) on delete restrict,
  uploaded_by_visitor_session_id uuid,
  failure_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (job_id, id),
  unique (workspace_id, job_id, id),
  unique (workspace_id, job_id, release_id, id),
  check ((kind = 'issue_photo') = (release_id is not null)),
  check (
    (uploaded_by_user_id is not null and uploaded_by_visitor_session_id is null)
    or (uploaded_by_user_id is null and uploaded_by_visitor_session_id is not null)
  ),
  check (
    (status = 'ready' and sha256 is not null and completed_at is not null)
    or (status <> 'ready' and completed_at is null)
  ),
  check (
    storage_key = 'workspaces/' || workspace_id::text || '/jobs/' || job_id::text ||
      '/assets/' || id::text || '/blob'
  ),
  foreign key (workspace_id, job_id)
    references public.jobs(workspace_id, id) on delete restrict
);
create index assets_job_status_idx on public.assets (job_id, status);
create index assets_release_idx on public.assets (release_id, id) where release_id is not null;

create table public.job_source_assets (
  workspace_id uuid not null,
  job_id uuid not null,
  asset_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (job_id, asset_id),
  foreign key (workspace_id, job_id)
    references public.jobs(workspace_id, id) on delete cascade,
  foreign key (workspace_id, job_id, asset_id)
    references public.assets(workspace_id, job_id, id) on delete restrict
);

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  job_id uuid not null,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('running', 'succeeded', 'failed', 'expired')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  base_job_version integer not null check (base_job_version > 0),
  base_draft_id uuid,
  base_draft_version integer,
  claim_token uuid not null,
  idempotency_record_id uuid not null unique,
  model_identifier text,
  draft_version integer,
  error_code text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  unique (job_id, id),
  check (expires_at > started_at),
  check ((state = 'succeeded') = (draft_version is not null)),
  check ((state = 'failed') = (error_code is not null)),
  check ((base_draft_id is null) = (base_draft_version is null)),
  foreign key (workspace_id, job_id)
    references public.jobs(workspace_id, id) on delete restrict
);
create index generations_job_started_idx on public.generations (job_id, started_at desc);
create index generations_running_lease_idx on public.generations (expires_at)
  where state = 'running';

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  job_id uuid not null,
  version integer not null default 1 check (version > 0),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  generation_id uuid,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, id),
  unique (workspace_id, job_id, id),
  foreign key (workspace_id, job_id)
    references public.jobs(workspace_id, id) on delete restrict
);
create index drafts_job_updated_idx on public.drafts (job_id, updated_at desc);

alter table public.drafts
  add constraint drafts_generation_same_job_fk
  foreign key (job_id, generation_id)
  references public.generations(job_id, id) on delete restrict;

create table public.draft_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  job_id uuid not null,
  draft_id uuid not null,
  kind text not null check (kind in ('design', 'process')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  draft_version integer not null check (draft_version > 0),
  reviewed_at timestamptz not null default now(),
  unique (draft_id, draft_version, kind),
  foreign key (workspace_id, job_id)
    references public.jobs(workspace_id, id) on delete restrict,
  foreign key (workspace_id, job_id, draft_id)
    references public.drafts(workspace_id, job_id, id) on delete restrict
);
create index draft_reviews_current_lookup_idx
  on public.draft_reviews (draft_id, draft_version, kind);

alter table public.jobs
  add constraint jobs_current_draft_same_job_fk
  foreign key (id, current_draft_id)
  references public.drafts(job_id, id) on delete restrict;

create table public.releases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  job_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  source_draft_id uuid not null,
  source_draft_version integer not null check (source_draft_version > 0),
  reviews jsonb not null check (jsonb_typeof(reviews) = 'array'),
  published_at timestamptz not null default now(),
  published_by uuid not null references auth.users(id) on delete restrict,
  supersedes_release_id uuid,
  allow_predecessor_visitors boolean not null default false,
  unique (job_id, revision_number),
  unique (job_id, id),
  unique (workspace_id, job_id, id),
  unique (id, job_id),
  foreign key (workspace_id, job_id)
    references public.jobs(workspace_id, id) on delete restrict,
  foreign key (workspace_id, job_id, source_draft_id)
    references public.drafts(workspace_id, job_id, id) on delete restrict,
  foreign key (job_id, supersedes_release_id)
    references public.releases(job_id, id) on delete restrict
);
create index releases_job_published_idx
  on public.releases (job_id, revision_number desc);

alter table public.jobs
  add constraint jobs_latest_release_same_job_fk
  foreign key (id, latest_release_id)
  references public.releases(job_id, id) on delete restrict;

alter table public.assets
  add constraint assets_release_same_job_fk
  foreign key (job_id, release_id)
  references public.releases(job_id, id) on delete restrict;

create table public.release_assets (
  workspace_id uuid not null,
  job_id uuid not null,
  release_id uuid not null,
  asset_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (release_id, asset_id),
  foreign key (workspace_id, job_id, release_id)
    references public.releases(workspace_id, job_id, id) on delete restrict,
  foreign key (workspace_id, job_id, asset_id)
    references public.assets(workspace_id, job_id, id) on delete restrict
);
create index release_assets_asset_idx on public.release_assets (asset_id, release_id);

create table public.release_access_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  job_id uuid not null,
  release_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (workspace_id, job_id, release_id, id),
  foreign key (workspace_id, job_id, release_id)
    references public.releases(workspace_id, job_id, id) on delete restrict
);
create index release_access_links_release_idx
  on public.release_access_links (release_id, revoked_at);

-- One cookie session remains bound to its original access link. Explicitly
-- following an allowed replacement inserts another row in the grants table;
-- it never switches the visitor's current release implicitly.
create table public.release_visitor_sessions (
  id uuid primary key default gen_random_uuid(),
  access_link_id uuid not null references public.release_access_links(id) on delete restrict,
  session_token_hash text not null unique check (session_token_hash ~ '^[0-9a-f]{64}$'),
  display_name text not null default 'Shop floor visitor'
    check (length(btrim(display_name)) > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at),
  unique (access_link_id, id)
);
create index release_visitor_sessions_link_idx
  on public.release_visitor_sessions (access_link_id, expires_at);

create table public.release_visitor_session_grants (
  workspace_id uuid not null,
  job_id uuid not null,
  session_id uuid not null,
  origin_release_id uuid not null,
  origin_access_link_id uuid not null,
  release_id uuid not null,
  granted_at timestamptz not null default now(),
  grant_kind text not null check (grant_kind in ('original_link', 'explicit_replacement_follow')),
  primary key (session_id, release_id),
  check (
    (grant_kind = 'original_link' and release_id = origin_release_id)
    or (grant_kind = 'explicit_replacement_follow' and release_id <> origin_release_id)
  ),
  foreign key (origin_access_link_id, session_id)
    references public.release_visitor_sessions(access_link_id, id) on delete restrict,
  foreign key (workspace_id, job_id, origin_release_id, origin_access_link_id)
    references public.release_access_links(workspace_id, job_id, release_id, id) on delete restrict,
  foreign key (workspace_id, job_id, release_id)
    references public.releases(workspace_id, job_id, id) on delete restrict
);
create index release_visitor_grants_release_idx
  on public.release_visitor_session_grants (release_id, session_id);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  job_id uuid not null,
  release_id uuid,
  draft_id uuid,
  draft_version integer,
  step_id uuid,
  bend_id text,
  question text not null check (length(btrim(question)) > 0),
  actor_kind text not null check (actor_kind in ('member', 'release_visitor')),
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_session_id uuid references public.release_visitor_sessions(id) on delete restrict,
  answer jsonb check (answer is null or jsonb_typeof(answer) = 'object'),
  model_identifier text,
  idempotency_record_id uuid not null unique,
  created_at timestamptz not null default now(),
  check ((release_id is not null) <> (draft_id is not null)),
  check (
    (draft_id is null and draft_version is null)
    or (draft_id is not null and draft_version is not null and draft_version > 0)
  ),
  check (
    (actor_kind = 'member' and actor_user_id is not null and actor_session_id is null)
    or (actor_kind = 'release_visitor' and actor_user_id is null and actor_session_id is not null and release_id is not null)
  ),
  foreign key (workspace_id, job_id)
    references public.jobs(workspace_id, id) on delete restrict,
  foreign key (workspace_id, job_id, release_id)
    references public.releases(workspace_id, job_id, id) on delete restrict,
  foreign key (workspace_id, job_id, draft_id)
    references public.drafts(workspace_id, job_id, id) on delete restrict
);
create index questions_release_created_idx on public.questions (release_id, created_at desc);
create index questions_draft_created_idx on public.questions (draft_id, draft_version, created_at desc)
  where draft_id is not null;

create table public.flags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  job_id uuid not null,
  release_id uuid not null,
  step_id uuid,
  bend_id text,
  question text not null check (length(btrim(question)) > 0),
  created_by_kind text not null check (created_by_kind in ('member', 'release_visitor')),
  created_by_user_id uuid references auth.users(id) on delete restrict,
  created_by_session_id uuid references public.release_visitor_sessions(id) on delete restrict,
  created_by_display_name text not null check (length(btrim(created_by_display_name)) > 0),
  version integer not null default 1 check (version > 0),
  status text not null default 'open' check (status in ('open', 'responded', 'resolved')),
  created_at timestamptz not null default now(),
  unique (workspace_id, job_id, release_id, id),
  check (
    (created_by_kind = 'member' and created_by_user_id is not null and created_by_session_id is null)
    or (created_by_kind = 'release_visitor' and created_by_user_id is null and created_by_session_id is not null)
  ),
  foreign key (workspace_id, job_id, release_id)
    references public.releases(workspace_id, job_id, id) on delete restrict
);
create index flags_release_status_created_idx
  on public.flags (release_id, status, created_at desc);
create index flags_job_created_idx on public.flags (job_id, created_at desc);

create table public.flag_photo_assets (
  workspace_id uuid not null,
  job_id uuid not null,
  release_id uuid not null,
  flag_id uuid not null,
  asset_id uuid not null,
  attached_at timestamptz not null default now(),
  primary key (flag_id, asset_id),
  foreign key (workspace_id, job_id, release_id, flag_id)
    references public.flags(workspace_id, job_id, release_id, id) on delete restrict,
  foreign key (workspace_id, job_id, release_id, asset_id)
    references public.assets(workspace_id, job_id, release_id, id) on delete restrict
);
create index flag_photo_assets_asset_idx on public.flag_photo_assets (asset_id);

create table public.flag_responses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  job_id uuid not null,
  release_id uuid not null,
  flag_id uuid not null,
  flag_version integer not null check (flag_version > 1),
  text text not null check (length(btrim(text)) > 0),
  author_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('explanation', 'replacement_release')),
  replacement_release_id uuid,
  created_at timestamptz not null default now(),
  unique (flag_id, flag_version),
  check ((kind = 'replacement_release') = (replacement_release_id is not null)),
  foreign key (workspace_id, job_id, release_id, flag_id)
    references public.flags(workspace_id, job_id, release_id, id) on delete restrict,
  foreign key (job_id, replacement_release_id)
    references public.releases(job_id, id) on delete restrict
);
create index flag_responses_flag_created_idx
  on public.flag_responses (flag_id, created_at desc);

create table public.acknowledgements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  job_id uuid not null,
  release_id uuid not null,
  flag_id uuid not null,
  flag_version integer not null check (flag_version > 1),
  actor_kind text not null check (actor_kind in ('member', 'release_visitor')),
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_session_id uuid references public.release_visitor_sessions(id) on delete restrict,
  acknowledged_at timestamptz not null default now(),
  check (
    (actor_kind = 'member' and actor_user_id is not null and actor_session_id is null)
    or (actor_kind = 'release_visitor' and actor_user_id is null and actor_session_id is not null)
  ),
  foreign key (workspace_id, job_id, release_id, flag_id)
    references public.flags(workspace_id, job_id, release_id, id) on delete restrict
);
create unique index acknowledgements_member_actor_version_unique
  on public.acknowledgements (flag_id, actor_user_id, flag_version)
  where actor_kind = 'member';
create unique index acknowledgements_visitor_actor_version_unique
  on public.acknowledgements (flag_id, actor_session_id, flag_version)
  where actor_kind = 'release_visitor';
create index acknowledgements_flag_idx on public.acknowledgements (flag_id, acknowledged_at desc);

create table public.review_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  job_id uuid not null,
  draft_id uuid not null,
  author_id uuid not null references auth.users(id) on delete restrict,
  text text not null check (length(btrim(text)) > 0),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, job_id, draft_id)
    references public.drafts(workspace_id, job_id, id) on delete restrict
);
create index review_notes_draft_created_idx on public.review_notes (draft_id, created_at);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  job_id uuid,
  release_id uuid,
  actor_kind text not null check (actor_kind in ('member', 'release_visitor', 'system')),
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_session_id uuid references public.release_visitor_sessions(id) on delete restrict,
  event_type text not null check (length(btrim(event_type)) > 0),
  entity_id uuid,
  request_id text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  check (
    (actor_kind = 'member' and actor_user_id is not null and actor_session_id is null)
    or (actor_kind = 'release_visitor' and actor_user_id is null and actor_session_id is not null)
    or (actor_kind = 'system' and actor_user_id is null and actor_session_id is null)
  ),
  foreign key (workspace_id, job_id)
    references public.jobs(workspace_id, id) on delete restrict,
  foreign key (workspace_id, job_id, release_id)
    references public.releases(workspace_id, job_id, id) on delete restrict
);
create index audit_events_workspace_created_idx
  on public.audit_events (workspace_id, created_at desc);
create index audit_events_job_created_idx
  on public.audit_events (job_id, created_at desc);

-- The idempotency actor is either a verified member user ID or a server-issued
-- visitor session ID; never a typed visitor name or a raw bearer token.
create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  actor_kind text not null check (actor_kind in ('member', 'release_visitor')),
  actor_id uuid not null,
  operation text not null check (length(btrim(operation)) > 0),
  idempotency_key text not null check (length(idempotency_key) between 16 and 128),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('running', 'completed', 'failed')),
  claim_token uuid,
  response jsonb,
  resource_id uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_kind, actor_id, operation, idempotency_key),
  check ((state = 'completed') = (response is not null))
);
alter table public.generations
  add constraint generations_idempotency_record_fk
  foreign key (idempotency_record_id)
  references public.idempotency_records(id) on delete restrict;
alter table public.generations
  add constraint generations_base_draft_same_job_fk
  foreign key (job_id, base_draft_id)
  references public.drafts(job_id, id) on delete restrict;
alter table public.questions
  add constraint questions_idempotency_record_fk
  foreign key (idempotency_record_id)
  references public.idempotency_records(id) on delete restrict;
create index idempotency_records_lease_idx
  on public.idempotency_records (lease_expires_at) where state = 'running';

-- Read-only membership predicate. SECURITY DEFINER is restricted to this
-- non-exposed schema, uses a fixed empty search_path, compares the argument to
-- auth.uid(), and reads only workspace_members. It breaks the RLS recursion
-- otherwise caused by membership policies consulting membership rows.
create or replace function private.has_workspace_access(
  p_workspace_id uuid,
  p_user_id uuid,
  p_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    p_user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members as wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          p_roles is null
          or wm.role = 'admin'
          or wm.role = any (p_roles)
        )
    ),
    false
  );
$function$;
revoke all on function private.has_workspace_access(uuid, uuid, text[]) from public, anon;
grant execute on function private.has_workspace_access(uuid, uuid, text[]) to authenticated;

create or replace function private.reject_immutable_row_change()
returns trigger
language plpgsql
set search_path = ''
as $trigger$
begin
  raise exception '%.% rows are append-only', tg_table_schema, tg_table_name
    using errcode = '55000';
end;
$trigger$;
revoke all on function private.reject_immutable_row_change() from public, anon, authenticated;

create or replace function private.enforce_release_asset_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $trigger$
declare
  v_snapshot jsonb;
  v_asset public.assets%rowtype;
begin
  select r.snapshot into v_snapshot
  from public.releases as r
  where r.id = new.release_id
    and r.workspace_id = new.workspace_id
    and r.job_id = new.job_id;

  if v_snapshot is null or not exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_snapshot->'sourceAssetIds', '[]'::jsonb)) as source(asset_id)
    where source.asset_id = new.asset_id::text
  ) then
    raise exception 'RELEASE_ASSET_NOT_IN_SNAPSHOT' using errcode = '23514';
  end if;

  select a.* into v_asset
  from public.assets as a
  join public.job_source_assets as jsa
    on jsa.workspace_id = a.workspace_id
   and jsa.job_id = a.job_id
   and jsa.asset_id = a.id
  where a.id = new.asset_id
    and a.workspace_id = new.workspace_id
    and a.job_id = new.job_id;

  if not found or v_asset.status <> 'ready' or v_asset.sha256 is null
     or v_asset.kind = 'issue_photo' or v_asset.release_id is not null then
    raise exception 'RELEASE_ASSET_NOT_READY_SOURCE' using errcode = '23514';
  end if;

  return new;
end;
$trigger$;
revoke all on function private.enforce_release_asset_allowlist() from public, anon, authenticated;

create trigger release_assets_allowlist_insert
  before insert on public.release_assets
  for each row execute function private.enforce_release_asset_allowlist();

create trigger workshop_versions_immutable
  before update or delete on public.workshop_versions
  for each row execute function private.reject_immutable_row_change();
create trigger workshop_confirmations_immutable
  before update or delete on public.workshop_snapshot_confirmations
  for each row execute function private.reject_immutable_row_change();
create trigger releases_immutable
  before update or delete on public.releases
  for each row execute function private.reject_immutable_row_change();
create trigger release_assets_immutable
  before update or delete on public.release_assets
  for each row execute function private.reject_immutable_row_change();
create trigger draft_reviews_immutable
  before update or delete on public.draft_reviews
  for each row execute function private.reject_immutable_row_change();
create trigger flag_responses_immutable
  before update or delete on public.flag_responses
  for each row execute function private.reject_immutable_row_change();
create trigger acknowledgements_immutable
  before update or delete on public.acknowledgements
  for each row execute function private.reject_immutable_row_change();
create trigger review_notes_immutable
  before update or delete on public.review_notes
  for each row execute function private.reject_immutable_row_change();
create trigger audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function private.reject_immutable_row_change();

-- All application tables, including sensitive token/session/idempotency tables,
-- are RLS-enabled. Explicit grants below expose only member-readable rows.
alter table public.workspaces enable row level security;
alter table public.user_profiles enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.workshops enable row level security;
alter table public.workshop_versions enable row level security;
alter table public.workshop_snapshot_confirmations enable row level security;
alter table public.jobs enable row level security;
alter table public.assets enable row level security;
alter table public.job_source_assets enable row level security;
alter table public.generations enable row level security;
alter table public.drafts enable row level security;
alter table public.draft_reviews enable row level security;
alter table public.releases enable row level security;
alter table public.release_assets enable row level security;
alter table public.release_access_links enable row level security;
alter table public.release_visitor_sessions enable row level security;
alter table public.release_visitor_session_grants enable row level security;
alter table public.questions enable row level security;
alter table public.flags enable row level security;
alter table public.flag_photo_assets enable row level security;
alter table public.flag_responses enable row level security;
alter table public.acknowledgements enable row level security;
alter table public.review_notes enable row level security;
alter table public.audit_events enable row level security;
alter table public.idempotency_records enable row level security;

revoke all on table public.workspaces, public.user_profiles, public.workspace_members,
  public.workspace_invites, public.workshops, public.workshop_versions,
  public.workshop_snapshot_confirmations, public.jobs, public.assets,
  public.job_source_assets, public.generations, public.drafts, public.draft_reviews,
  public.releases, public.release_assets, public.release_access_links,
  public.release_visitor_sessions, public.release_visitor_session_grants,
  public.questions, public.flags, public.flag_photo_assets, public.flag_responses,
  public.acknowledgements, public.review_notes, public.audit_events,
  public.idempotency_records
  from anon, authenticated;
grant all on table public.workspaces, public.user_profiles, public.workspace_members,
  public.workspace_invites, public.workshops, public.workshop_versions,
  public.workshop_snapshot_confirmations, public.jobs, public.assets,
  public.job_source_assets, public.generations, public.drafts, public.draft_reviews,
  public.releases, public.release_assets, public.release_access_links,
  public.release_visitor_sessions, public.release_visitor_session_grants,
  public.questions, public.flags, public.flag_photo_assets, public.flag_responses,
  public.acknowledgements, public.review_notes, public.audit_events,
  public.idempotency_records
  to service_role;
grant select on table public.workspaces, public.workspace_members, public.workshops,
  public.workshop_versions, public.workshop_snapshot_confirmations, public.jobs,
  public.assets, public.job_source_assets, public.generations, public.drafts,
  public.draft_reviews, public.releases, public.release_assets, public.questions,
  public.flags, public.flag_photo_assets, public.flag_responses,
  public.acknowledgements, public.review_notes
  to authenticated;
grant select on table public.user_profiles to authenticated;

create policy workspaces_member_read on public.workspaces
  for select to authenticated
  using ((select private.has_workspace_access(id, (select auth.uid()), null)));

create policy user_profiles_self_read on public.user_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy workspace_members_scoped_read on public.workspace_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.has_workspace_access(workspace_id, (select auth.uid()), null))
  );

create policy workshops_member_read on public.workshops
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy workshop_versions_member_read on public.workshop_versions
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy workshop_confirmations_member_read on public.workshop_snapshot_confirmations
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));

create policy jobs_member_read on public.jobs
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy assets_member_read on public.assets
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy job_source_assets_member_read on public.job_source_assets
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy generations_member_read on public.generations
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy drafts_member_read on public.drafts
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy draft_reviews_member_read on public.draft_reviews
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy releases_member_read on public.releases
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy release_assets_member_read on public.release_assets
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy questions_member_read on public.questions
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy flags_member_read on public.flags
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy flag_photos_member_read on public.flag_photo_assets
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy flag_responses_member_read on public.flag_responses
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy acknowledgements_member_read on public.acknowledgements
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy review_notes_member_read on public.review_notes
  for select to authenticated
  using ((select private.has_workspace_access(workspace_id, (select auth.uid()), null)));
create policy audit_events_admin_read on public.audit_events
  for select to authenticated
  using (
    workspace_id is not null
    and (select private.has_workspace_access(workspace_id, (select auth.uid()), array['admin']::text[]))
  );

-- Supabase Storage policy surface. The bucket stays private. Authenticated
-- members can directly read ready assets in their workspace and insert only a
-- prepared source asset row that they own. There are intentionally no direct
-- UPDATE/DELETE policies (including no upsert). Visitor photo writes and all
-- visitor reads pass through an API that revalidates the release session.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'skunkworks-private',
  'skunkworks-private',
  false,
  null,
  array[
    'application/pdf',
    'application/json',
    'model/gltf-binary',
    'application/octet-stream',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy skunkworks_member_read_ready_objects
  on storage.objects for select to authenticated
  using (
    bucket_id = 'skunkworks-private'
    and exists (
      select 1
      from public.assets as a
      where a.storage_key = storage.objects.name
        and a.status = 'ready'
        and private.has_workspace_access(a.workspace_id, (select auth.uid()), null)
    )
  );

create policy skunkworks_member_insert_prepared_source
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'skunkworks-private'
    and exists (
      select 1
      from public.assets as a
      where a.storage_key = storage.objects.name
        and a.status = 'pending'
        and a.kind <> 'issue_photo'
        and a.uploaded_by_user_id = (select auth.uid())
        and private.has_workspace_access(a.workspace_id, (select auth.uid()), array['designer']::text[])
    )
  );

-- Object key is the asset's immutable UUID path. The upload token is a
-- separate, time-limited, single-object capability returned to the initiating
-- member; the source filename is metadata and is never interpolated into a key.

-- Scoped rate state uses database time and a globally aligned 5-minute window.
-- The access-link key prevents creating fresh visitor sessions from resetting
-- the question/flag budget for the same QR link.
create table public.release_visitor_rate_limits (
  access_link_id uuid not null references public.release_access_links(id) on delete restrict,
  operation text not null check (operation in ('question', 'flag')),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (access_link_id, operation)
);
alter table public.release_visitor_rate_limits enable row level security;
revoke all on table public.release_visitor_rate_limits from anon, authenticated;
grant all on table public.release_visitor_rate_limits to service_role;

-- Reserve an idempotency key under an actor + operation scope. A lease can be
-- reclaimed after a crashed request; different payloads can never reuse it.
create or replace function public.claim_idempotency_internal(
  p_actor_kind text,
  p_actor_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_payload_hash text,
  p_lease_seconds integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_record public.idempotency_records%rowtype;
  v_new_token uuid;
  v_lease_seconds integer;
begin
  if p_actor_kind not in ('member', 'release_visitor')
    or p_actor_id is null
    or length(p_operation) = 0
    or length(p_idempotency_key) not between 16 and 128
    or p_payload_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  if p_actor_kind = 'member' and not exists (
    select 1 from auth.users as u where u.id = p_actor_id
  ) then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if p_actor_kind = 'release_visitor' and not exists (
    select 1
    from public.release_visitor_sessions as s
    join public.release_access_links as l on l.id = s.access_link_id
    where s.id = p_actor_id
      and s.revoked_at is null
      and s.expires_at > clock_timestamp()
      and l.revoked_at is null
  ) then
    raise exception 'RELEASE_REVOKED' using errcode = '42501';
  end if;

  v_lease_seconds := greatest(10, least(coalesce(p_lease_seconds, 90), 900));
  v_new_token := gen_random_uuid();

  insert into public.idempotency_records (
    actor_kind, actor_id, operation, idempotency_key, payload_hash,
    state, claim_token, lease_expires_at
  ) values (
    p_actor_kind, p_actor_id, p_operation, p_idempotency_key, p_payload_hash,
    'running', v_new_token, clock_timestamp() + make_interval(secs => v_lease_seconds)
  )
  on conflict (actor_kind, actor_id, operation, idempotency_key) do nothing;

  select *
  into v_record
  from public.idempotency_records
  where actor_kind = p_actor_kind
    and actor_id = p_actor_id
    and operation = p_operation
    and idempotency_key = p_idempotency_key
  for update;

  if v_record.payload_hash <> p_payload_hash then
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
  end if;

  if v_record.state = 'completed' or v_record.state = 'failed' then
    return jsonb_build_object(
      'state', v_record.state,
      'response', v_record.response,
      'resourceId', v_record.resource_id
    );
  end if;

  if v_record.lease_expires_at > clock_timestamp() and v_record.claim_token <> v_new_token then
    return jsonb_build_object(
      'state', 'running',
      'retryAfterSeconds',
      greatest(1, ceil(extract(epoch from (v_record.lease_expires_at - clock_timestamp())))::integer)
    );
  end if;

  if v_record.claim_token <> v_new_token then
    update public.idempotency_records
    set claim_token = v_new_token,
        lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
        updated_at = clock_timestamp()
    where id = v_record.id
    returning * into v_record;
  end if;

  return jsonb_build_object(
    'state', 'claimed',
    'recordId', v_record.id,
    'claimToken', v_record.claim_token,
    'leaseExpiresAt', v_record.lease_expires_at
  );
end;
$function$;

-- Read-modify-write endpoints call this from the SAME database transaction as
-- their domain mutation. This is a helper for RPCs, not a client-callable route.
create or replace function private.complete_idempotency(
  p_record_id uuid,
  p_claim_token uuid,
  p_response jsonb,
  p_resource_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.idempotency_records
  set state = 'completed',
      response = p_response,
      resource_id = p_resource_id,
      claim_token = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = p_record_id
    and state = 'running'
    and claim_token = p_claim_token;

  if not found then
    raise exception 'IDEMPOTENCY_CLAIM_LOST' using errcode = '40001';
  end if;
end;
$function$;

-- Fingerprint source and immutable selected profile identity from live rows.
-- The payload has only strings, booleans, nulls and integer versions, which
-- makes this recursive JSON serializer byte-compatible with JSON.stringify.
create or replace function private.canonical_jsonb_text(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_type text := jsonb_typeof(p_value);
  v_text text;
begin
  if v_type = 'object' then
    select '{' || coalesce(string_agg(
      to_json(entry.key)::text || ':' || private.canonical_jsonb_text(entry.value),
      ',' order by entry.key collate "C"
    ), '') || '}'
    into v_text
    from jsonb_each(p_value) as entry(key, value);
    return v_text;
  elsif v_type = 'array' then
    select '[' || coalesce(string_agg(
      private.canonical_jsonb_text(entry.value), ',' order by entry.ordinality
    ), '') || ']'
    into v_text
    from jsonb_array_elements(p_value) with ordinality as entry(value, ordinality);
    return v_text;
  elsif v_type = 'number' then
    if (p_value #>> '{}') !~ '^-?(0|[1-9][0-9]*)$' then
      raise exception 'FINGERPRINT_NON_INTEGER' using errcode = '22023';
    end if;
    return p_value #>> '{}';
  else
    return p_value::text;
  end if;
end;
$function$;
revoke all on function private.canonical_jsonb_text(jsonb) from public, anon, authenticated;

create or replace function private.current_job_input_fingerprint(
  p_workspace_id uuid,
  p_job_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_job public.jobs%rowtype;
  v_workshop_version public.workshop_versions%rowtype;
  v_source_assets jsonb;
  v_inputs jsonb;
begin
  select * into v_job
  from public.jobs
  where id = p_job_id and workspace_id = p_workspace_id;
  if not found or v_job.workshop_snapshot_id is null or v_job.machine_id is null then
    return null;
  end if;

  select * into v_workshop_version
  from public.workshop_versions as wv
  where wv.id = v_job.workshop_snapshot_id
    and wv.workspace_id = p_workspace_id
    and exists (
      select 1 from jsonb_array_elements(coalesce(wv.snapshot->'machines', '[]'::jsonb)) as machine
      where machine->>'id' = v_job.machine_id::text
    );
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'version', a.version,
    'sha256', a.sha256,
    'status', a.status
  ) order by a.id::text collate "C"), '[]'::jsonb)
  into v_source_assets
  from public.job_source_assets as jsa
  join public.assets as a
    on a.workspace_id = jsa.workspace_id
   and a.job_id = jsa.job_id
   and a.id = jsa.asset_id
  where jsa.workspace_id = p_workspace_id and jsa.job_id = p_job_id;

  v_inputs := jsonb_build_object(
    'contractVersion', '1.0',
    'partFamily', v_job.part_family,
    'workshopSnapshot', jsonb_build_object(
      'id', v_workshop_version.id,
      'version', v_workshop_version.version,
      'machineId', v_job.machine_id
    ),
    'sourceAssets', v_source_assets
  );

  return encode(extensions.digest(
    convert_to(private.canonical_jsonb_text(v_inputs), 'UTF8'), 'sha256'
  ), 'hex');
end;
$function$;
revoke all on function private.current_job_input_fingerprint(uuid, uuid) from public, anon, authenticated;

-- Atomic publication. The row locks serialize concurrent publications for a
-- job. Version/review/input gates are checked while locked; the immutable
-- release, release asset allow-list, job pointer and idempotency result commit
-- together. Retries with the same completed key replay the saved result.
create or replace function public.publish_release_internal(
  p_workspace_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_expected_draft_version integer,
  p_supersedes_release_id uuid,
  p_allow_predecessor_visitors boolean,
  p_idempotency_record_id uuid,
  p_idempotency_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.jobs%rowtype;
  v_draft public.drafts%rowtype;
  v_content jsonb;
  v_setup jsonb;
  v_reviews jsonb;
  v_review_count integer;
  v_release_id uuid;
  v_revision_number integer;
  v_source_count integer;
  v_distinct_source_count integer;
  v_ready_count integer;
  v_current_fingerprint text;
  v_result jsonb;
begin
  if not exists (
    select 1 from public.workspace_members as wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_actor_id
      and wm.status = 'active'
      and wm.role in ('admin', 'designer')
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select *
  into v_job
  from public.jobs
  where id = p_job_id and workspace_id = p_workspace_id
  for update;

  if not found or v_job.current_draft_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select *
  into v_draft
  from public.drafts
  where id = v_job.current_draft_id
    and job_id = v_job.id
    and workspace_id = v_job.workspace_id
  for update;

  if not found or v_draft.version <> p_expected_draft_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  perform 1
  from public.idempotency_records as i
  where i.id = p_idempotency_record_id
    and i.actor_kind = 'member'
    and i.actor_id = p_actor_id
    and i.operation = 'release.publish'
    and i.state = 'running'
    and i.claim_token = p_idempotency_claim_token
    and i.lease_expires_at > clock_timestamp()
  for update;

  if not found then
    raise exception 'IDEMPOTENCY_CLAIM_LOST' using errcode = '40001';
  end if;

  if v_job.workshop_snapshot_id is null or v_job.machine_id is null then
    raise exception 'REVIEW_REQUIRED' using errcode = '23514';
  end if;

  select wv.snapshot
  into v_setup
  from public.workshop_versions as wv
  join public.workshop_snapshot_confirmations as wc
    on wc.snapshot_id = wv.id
   and wc.workspace_id = wv.workspace_id
   and wc.workshop_id = wv.workshop_id
  where wv.workspace_id = v_job.workspace_id
    and wv.id = v_job.workshop_snapshot_id
    and exists (
      select 1
      from jsonb_array_elements(coalesce(wv.snapshot->'machines', '[]'::jsonb)) as machine
      where machine->>'id' = v_job.machine_id::text
    );

  if v_setup is null then
    raise exception 'REVIEW_REQUIRED' using errcode = '23514';
  end if;

  v_content := v_draft.content;
  if v_content->>'workshopSnapshotId' is distinct from v_job.workshop_snapshot_id::text
     or v_content->>'machineId' is distinct from v_job.machine_id::text
     or coalesce(v_content->'panelModel'->>'reviewed', 'false') <> 'true'
  then
    raise exception 'REVIEW_REQUIRED' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_content->'findings', '[]'::jsonb)) as finding
    where finding->>'severity' = 'blocking'
      and finding->>'disposition' = 'open'
  ) then
    raise exception 'REVIEW_REQUIRED' using errcode = '23514';
  end if;

  select count(*), count(distinct source.asset_id::uuid)
  into v_source_count, v_distinct_source_count
  from jsonb_array_elements_text(coalesce(v_content->'sourceAssetIds', '[]'::jsonb)) as source(asset_id);

  select count(*) into v_ready_count
  from jsonb_array_elements_text(coalesce(v_content->'sourceAssetIds', '[]'::jsonb)) as source(asset_id)
  join public.job_source_assets as jsa
    on jsa.workspace_id = v_job.workspace_id
   and jsa.job_id = v_job.id
   and jsa.asset_id = source.asset_id::uuid
  join public.assets as a
    on a.workspace_id = jsa.workspace_id
   and a.job_id = jsa.job_id
   and a.id = jsa.asset_id
  where a.status = 'ready'
    and a.kind <> 'issue_photo'
    and a.sha256 is not null;

  if v_source_count = 0
     or v_distinct_source_count <> v_source_count
     or v_ready_count <> v_source_count then
    raise exception 'REVIEW_REQUIRED' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.job_source_assets as jsa
    where jsa.job_id = v_job.id
      and not exists (
        select 1
        from jsonb_array_elements_text(coalesce(v_content->'sourceAssetIds', '[]'::jsonb)) as source(asset_id)
        where source.asset_id::uuid = jsa.asset_id
      )
  ) then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  select count(*),
         jsonb_agg(
           jsonb_build_object(
             'kind', dr.kind,
             'actorId', dr.actor_id,
             'draftVersion', dr.draft_version,
             'at', dr.reviewed_at
           ) order by dr.kind
         )
  into v_review_count, v_reviews
  from public.draft_reviews as dr
  where dr.workspace_id = v_job.workspace_id
    and dr.job_id = v_job.id
    and dr.draft_id = v_draft.id
    and dr.draft_version = v_draft.version;

  if v_review_count <> 2 then
    raise exception 'REVIEW_REQUIRED' using errcode = '23514';
  end if;

  if (
    select count(distinct dr.actor_id)
    from public.draft_reviews as dr
    join public.workspace_members as wm
      on wm.workspace_id = dr.workspace_id
     and wm.user_id = dr.actor_id
     and wm.status = 'active'
    where dr.workspace_id = v_job.workspace_id
      and dr.job_id = v_job.id
      and dr.draft_id = v_draft.id
      and dr.draft_version = v_draft.version
      and ((dr.kind = 'design' and wm.role in ('admin', 'designer'))
        or (dr.kind = 'process' and wm.role in ('admin', 'fabricator')))
  ) <> 2 then
    raise exception 'REVIEW_REQUIRED' using errcode = '23514';
  end if;

  v_current_fingerprint := private.current_job_input_fingerprint(v_job.workspace_id, v_job.id);
  if v_current_fingerprint is null or v_current_fingerprint is distinct from v_draft.input_fingerprint then
    raise exception 'REVIEW_REQUIRED' using errcode = '23514';
  end if;

  if v_job.latest_release_id is distinct from p_supersedes_release_id then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  if p_supersedes_release_id is not null and not exists (
    select 1 from public.releases as old_release
    where old_release.id = p_supersedes_release_id
      and old_release.job_id = v_job.id
  ) then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  select coalesce(max(revision_number), 0) + 1
  into v_revision_number
  from public.releases
  where job_id = v_job.id;

  v_release_id := gen_random_uuid();

  insert into public.releases (
    id, workspace_id, job_id, revision_number, snapshot, source_draft_id,
    source_draft_version, reviews, published_by, supersedes_release_id,
    allow_predecessor_visitors
  ) values (
    v_release_id, v_job.workspace_id, v_job.id, v_revision_number, v_content,
    v_draft.id, v_draft.version, coalesce(v_reviews, '[]'::jsonb), p_actor_id,
    p_supersedes_release_id, p_allow_predecessor_visitors
  );

  insert into public.release_assets (workspace_id, job_id, release_id, asset_id)
  select v_job.workspace_id, v_job.id, v_release_id, source.asset_id::uuid
  from jsonb_array_elements_text(coalesce(v_content->'sourceAssetIds', '[]'::jsonb)) as source(asset_id);

  update public.jobs
  set latest_release_id = v_release_id,
      version = version + 1
  where id = v_job.id
    and workspace_id = v_job.workspace_id;

  v_result := jsonb_build_object('releaseId', v_release_id, 'revisionNumber', v_revision_number);
  perform private.complete_idempotency(
    p_idempotency_record_id, p_idempotency_claim_token, v_result, v_release_id
  );
  return v_result;
end;
$function$;

-- Explicit visitor replacement follow. A valid session keeps its original link
-- binding; only a direct published successor whose publisher enabled the
-- predecessor flag can be added to that session's release allow-list.
create or replace function public.follow_release_replacement_internal(
  p_session_id uuid,
  p_current_release_id uuid,
  p_replacement_release_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_link public.release_access_links%rowtype;
  v_session public.release_visitor_sessions%rowtype;
  v_target public.releases%rowtype;
begin
  select s, l
  into v_session, v_link
  from public.release_visitor_sessions as s
  join public.release_access_links as l on l.id = s.access_link_id
  where s.id = p_session_id
    and s.revoked_at is null
    and s.expires_at > clock_timestamp()
    and l.revoked_at is null
  for update of s, l;

  if not found then
    raise exception 'RELEASE_REVOKED' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.release_visitor_session_grants as g
    where g.session_id = v_session.id
      and g.release_id = p_current_release_id
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select *
  into v_target
  from public.releases as r
  where r.id = p_replacement_release_id
    and r.job_id = v_link.job_id
    and r.supersedes_release_id = p_current_release_id
    and r.allow_predecessor_visitors
  for share;

  if not found then
    raise exception 'RELEASE_REVOKED' using errcode = '42501';
  end if;

  insert into public.release_visitor_session_grants (
    workspace_id, job_id, session_id, origin_release_id,
    origin_access_link_id, release_id, grant_kind
  ) values (
    v_target.workspace_id, v_target.job_id, v_session.id, v_link.release_id,
    v_link.id, v_target.id, 'explicit_replacement_follow'
  )
  on conflict (session_id, release_id) do nothing;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'releaseId', v_target.id,
    'jobId', v_target.job_id,
    'explicitFollowRequired', true
  );
end;
$function$;

-- Atomic, globally aligned fixed-window budget per QR access link. Defaults are
-- 20 questions or 8 flags per five-minute window. Tune in reviewed migrations,
-- not per request, so a caller cannot increase its own limit.
create or replace function public.consume_visitor_rate_limit_internal(
  p_session_id uuid,
  p_release_id uuid,
  p_operation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_access_link_id uuid;
  v_limit integer;
  v_window_seconds integer := 300;
  v_window timestamptz;
  v_count integer;
  v_current_started timestamptz;
  v_current_count integer;
  v_retry_after integer;
begin
  if p_operation = 'question' then
    v_limit := 20;
  elsif p_operation = 'flag' then
    v_limit := 8;
  else
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  select s.access_link_id
  into v_access_link_id
  from public.release_visitor_sessions as s
  join public.release_access_links as l on l.id = s.access_link_id
  where s.id = p_session_id
    and s.revoked_at is null
    and s.expires_at > clock_timestamp()
    and l.revoked_at is null
    and exists (
      select 1
      from public.release_visitor_session_grants as g
      where g.session_id = s.id and g.release_id = p_release_id
    )
  for key share of s, l;

  if not found then
    raise exception 'RELEASE_REVOKED' using errcode = '42501';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds
  );

  insert into public.release_visitor_rate_limits (
    access_link_id, operation, window_started_at, request_count, updated_at
  ) values (
    v_access_link_id, p_operation, v_window, 1, clock_timestamp()
  )
  on conflict (access_link_id, operation) do update
  set window_started_at = excluded.window_started_at,
      request_count = case
        when public.release_visitor_rate_limits.window_started_at < excluded.window_started_at then 1
        else public.release_visitor_rate_limits.request_count + 1
      end,
      updated_at = clock_timestamp()
  where public.release_visitor_rate_limits.window_started_at < excluded.window_started_at
     or public.release_visitor_rate_limits.request_count < v_limit
  returning request_count into v_count;

  if v_count is not null then
    return jsonb_build_object(
      'allowed', true,
      'count', v_count,
      'limit', v_limit,
      'windowResetsAt', v_window + make_interval(secs => v_window_seconds)
    );
  end if;

  select window_started_at, request_count
  into v_current_started, v_current_count
  from public.release_visitor_rate_limits
  where access_link_id = v_access_link_id and operation = p_operation;

  v_retry_after := greatest(
    1,
    ceil(extract(epoch from (
      v_current_started + make_interval(secs => v_window_seconds) - clock_timestamp()
    )))::integer
  );

  return jsonb_build_object(
    'allowed', false,
    'count', v_current_count,
    'limit', v_limit,
    'retryAfterSeconds', v_retry_after,
    'windowResetsAt', v_current_started + make_interval(secs => v_window_seconds)
  );
end;
$function$;

-- Only server code holding the service key may call these narrowly scoped
-- functions. The key itself must never be bundled into the browser.
revoke all on function public.claim_idempotency_internal(text, uuid, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function private.complete_idempotency(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.publish_release_internal(uuid, uuid, uuid, integer, uuid, boolean, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.follow_release_replacement_internal(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.consume_visitor_rate_limit_internal(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.claim_idempotency_internal(text, uuid, text, text, text, integer)
  to service_role;
grant execute on function private.complete_idempotency(uuid, uuid, jsonb, uuid)
  to service_role;
grant execute on function public.publish_release_internal(uuid, uuid, uuid, integer, uuid, boolean, uuid, uuid)
  to service_role;
grant execute on function public.follow_release_replacement_internal(uuid, uuid, uuid)
  to service_role;
grant execute on function public.consume_visitor_rate_limit_internal(uuid, uuid, text)
  to service_role;

-- API routes must still validate GET/POST actor/session context, CSRF/origin,
-- file MIME/size/hash, DTO evidence/geometry, and the release snapshot's exact
-- source/flag-photo allow-list. These RPCs are defense-in-depth transaction
-- boundaries, not a replacement for route-level authentication.

-- Job-input mutations increment the job version and the current draft content
-- version in one transaction. Old review rows remain immutable and cannot
-- match the bumped draft version.
create or replace function public.update_job_inputs_internal(
  p_workspace_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_expected_job_version integer,
  p_workshop_snapshot_id uuid,
  p_machine_id uuid,
  p_source_asset_ids jsonb,
  p_part_family text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.jobs%rowtype;
  v_snapshot jsonb;
  v_count integer;
  v_matched integer;
  v_draft_version integer;
begin
  if not exists (
    select 1 from public.workspace_members as wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_actor_id
      and wm.status = 'active'
      and wm.role in ('admin', 'designer')
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if jsonb_typeof(p_source_asset_ids) <> 'array'
     or length(btrim(p_part_family)) = 0
     or p_expected_job_version < 1
  then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_job.version <> p_expected_job_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  select wv.snapshot into v_snapshot
  from public.workshop_versions as wv
  join public.workshop_snapshot_confirmations as wc
    on wc.snapshot_id = wv.id
   and wc.workspace_id = wv.workspace_id
   and wc.workshop_id = wv.workshop_id
  where wv.workspace_id = p_workspace_id
    and wv.id = p_workshop_snapshot_id
    and exists (
      select 1 from jsonb_array_elements(coalesce(wv.snapshot->'machines', '[]'::jsonb)) as m
      where m->>'id' = p_machine_id::text
    );

  if v_snapshot is null then
    raise exception 'REVIEW_REQUIRED' using errcode = '23514';
  end if;

  select count(*), count(distinct source.asset_id::uuid)
  into v_count, v_matched
  from jsonb_array_elements_text(p_source_asset_ids) as source(asset_id);

  if v_count <> v_matched then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(p_source_asset_ids) as source(asset_id)
    left join public.assets as a
      on a.workspace_id = p_workspace_id
     and a.job_id = p_job_id
     and a.id = source.asset_id::uuid
    where a.id is null or a.kind = 'issue_photo' or a.status = 'failed'
  ) then
    raise exception 'UNSUPPORTED_ASSET' using errcode = '23514';
  end if;

  delete from public.job_source_assets
  where workspace_id = p_workspace_id and job_id = p_job_id;

  insert into public.job_source_assets (workspace_id, job_id, asset_id)
  select p_workspace_id, p_job_id, source.asset_id::uuid
  from jsonb_array_elements_text(p_source_asset_ids) as source(asset_id);

  update public.jobs
  set part_family = btrim(p_part_family),
      workshop_snapshot_id = p_workshop_snapshot_id,
      machine_id = p_machine_id,
      version = version + 1
  where id = p_job_id and workspace_id = p_workspace_id;

  if v_job.current_draft_id is not null then
    update public.drafts
    set version = version + 1,
        updated_at = clock_timestamp()
    where id = v_job.current_draft_id
      and job_id = p_job_id
      and workspace_id = p_workspace_id
    returning version into v_draft_version;
  end if;

  return jsonb_build_object(
    'jobId', p_job_id,
    'version', p_expected_job_version + 1,
    'draftId', v_job.current_draft_id,
    'draftVersion', v_draft_version
  );
end;
$function$;

-- Content saves are compare-and-swap operations on the current draft only.
-- Authority-bearing fields are reconstructed here even though the API schema
-- strips them too, so a privileged route cannot accidentally preserve a
-- client-forged reviewed flag, finding resolution or proposal decision.
create or replace function public.save_draft_content_internal(
  p_workspace_id uuid,
  p_job_id uuid,
  p_draft_id uuid,
  p_actor_id uuid,
  p_expected_version integer,
  p_content jsonb,
  p_input_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.jobs%rowtype;
  v_draft public.drafts%rowtype;
  v_content jsonb;
begin
  if not exists (
    select 1 from public.workspace_members as wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_actor_id
      and wm.status = 'active'
      and wm.role in ('admin', 'designer')
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if jsonb_typeof(p_content) <> 'object'
     or p_input_fingerprint !~ '^[0-9a-f]{64}$'
     or p_expected_version < 1
  then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id and workspace_id = p_workspace_id
  for update;

  if not found or v_job.current_draft_id is distinct from p_draft_id then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  select * into v_draft
  from public.drafts
  where id = p_draft_id and job_id = p_job_id and workspace_id = p_workspace_id
  for update;

  if not found or v_draft.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  v_content := p_content;
  if jsonb_typeof(v_content->'panelModel') = 'object' then
    v_content := jsonb_set(v_content, '{panelModel,reviewed}', 'false'::jsonb, true);
  end if;
  v_content := jsonb_set(
    v_content,
    '{findings}',
    coalesce((
      select jsonb_agg(finding || jsonb_build_object(
        'disposition', 'open',
        'resolutionRecordId', null
      ))
      from jsonb_array_elements(coalesce(v_content->'findings', '[]'::jsonb)) as finding
    ), '[]'::jsonb),
    true
  );
  v_content := jsonb_set(
    v_content,
    '{machineProposals}',
    coalesce((
      select jsonb_agg(proposal || jsonb_build_object(
        'status', 'proposed',
        'decidedBy', null
      ))
      from jsonb_array_elements(coalesce(v_content->'machineProposals', '[]'::jsonb)) as proposal
    ), '[]'::jsonb),
    true
  );

  update public.drafts
  set content = v_content,
      input_fingerprint = p_input_fingerprint,
      version = version + 1,
      updated_at = clock_timestamp()
  where id = p_draft_id
    and job_id = p_job_id
    and workspace_id = p_workspace_id
    and version = p_expected_version;

  return jsonb_build_object(
    'draftId', p_draft_id,
    'version', p_expected_version + 1,
    'inputFingerprint', p_input_fingerprint
  );
end;
$function$;

revoke all on function public.update_job_inputs_internal(uuid, uuid, uuid, integer, uuid, uuid, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.save_draft_content_internal(uuid, uuid, uuid, uuid, integer, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.update_job_inputs_internal(uuid, uuid, uuid, integer, uuid, uuid, jsonb, text)
  to service_role;
grant execute on function public.save_draft_content_internal(uuid, uuid, uuid, uuid, integer, jsonb, text)
  to service_role;

-- Narrow authorization and DTO helpers used only from server-only RPCs.
create or replace function private.require_member_role(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_roles text[] default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text;
begin
  select wm.role into v_role
  from public.workspace_members as wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_actor_id
    and wm.status = 'active';
  if not found or (p_roles is not null and v_role <> 'admin' and not v_role = any (p_roles)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return v_role;
end;
$function$;
revoke all on function private.require_member_role(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function private.require_member_role(uuid, uuid, text[]) to service_role;

create or replace function private.asset_dto(p_asset public.assets)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p_asset.id,
    'jobId', p_asset.job_id,
    'releaseId', p_asset.release_id,
    'kind', p_asset.kind,
    'filename', p_asset.filename,
    'mimeType', p_asset.mime_type,
    'byteSize', p_asset.byte_size,
    'sha256', p_asset.sha256,
    'version', p_asset.version,
    'status', p_asset.status,
    'drawingRevision', p_asset.drawing_revision
  );
$function$;
revoke all on function private.asset_dto(public.assets) from public, anon, authenticated;

create or replace function private.draft_dto(p_draft_id uuid, p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', d.id,
    'jobId', d.job_id,
    'version', d.version,
    'content', d.content,
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', dr.kind,
        'actorId', dr.actor_id,
        'draftVersion', dr.draft_version,
        'at', dr.reviewed_at
      ) order by dr.reviewed_at)
      from public.draft_reviews as dr
      where dr.workspace_id = d.workspace_id
        and dr.draft_id = d.id
        and dr.draft_version = d.version
    ), '[]'::jsonb),
    'generationId', d.generation_id,
    'inputFingerprint', d.input_fingerprint
  )
  from public.drafts as d
  where d.id = p_draft_id and d.workspace_id = p_workspace_id;
$function$;
revoke all on function private.draft_dto(uuid, uuid) from public, anon, authenticated;

create or replace function private.release_visitor_scope(p_session_id uuid, p_release_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_scope jsonb;
begin
  select jsonb_build_object(
    'sessionId', s.id,
    'releaseId', g.release_id,
    'accessLinkId', l.id,
    'displayName', s.display_name,
    'workspaceId', g.workspace_id,
    'jobId', g.job_id,
    'expiresAt', s.expires_at
  ) into v_scope
  from public.release_visitor_sessions as s
  join public.release_access_links as l on l.id = s.access_link_id
  join public.release_visitor_session_grants as g
    on g.session_id = s.id and g.origin_access_link_id = l.id
  where s.id = p_session_id
    and g.release_id = p_release_id
    and s.revoked_at is null
    and s.expires_at > clock_timestamp()
    and l.revoked_at is null;
  return v_scope;
end;
$function$;
revoke all on function private.release_visitor_scope(uuid, uuid) from public, anon, authenticated;

create or replace function private.flag_dto(p_flag_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', f.id,
    'context', jsonb_build_object(
      'jobId', f.job_id,
      'releaseId', f.release_id,
      'draftId', null,
      'draftVersion', null,
      'stepId', f.step_id,
      'bendId', f.bend_id
    ),
    'question', f.question,
    'photoAssetIds', coalesce((
      select jsonb_agg(fp.asset_id order by fp.attached_at)
      from public.flag_photo_assets as fp where fp.flag_id = f.id
    ), '[]'::jsonb),
    'createdBy', jsonb_build_object(
      'id', coalesce(f.created_by_user_id, f.created_by_session_id),
      'displayName', case when f.created_by_kind = 'release_visitor'
        then f.created_by_display_name
        else coalesce((select up.display_name from public.user_profiles as up where up.user_id = f.created_by_user_id), 'Member')
      end,
      'kind', f.created_by_kind,
      'roles', case when f.created_by_kind = 'member' then coalesce((
        select jsonb_agg(wm.role order by wm.role)
        from public.workspace_members as wm
        where wm.workspace_id = f.workspace_id and wm.user_id = f.created_by_user_id and wm.status = 'active'
      ), '[]'::jsonb) else '[]'::jsonb end
    ),
    'version', f.version,
    'status', f.status,
    'createdAt', f.created_at,
    'response', (
      select jsonb_build_object(
        'text', fr.text,
        'authorId', fr.author_id,
        'at', fr.created_at,
        'kind', fr.kind,
        'replacementReleaseId', fr.replacement_release_id
      )
      from public.flag_responses as fr
      where fr.flag_id = f.id
      order by fr.flag_version desc
      limit 1
    )
  )
  from public.flags as f where f.id = p_flag_id;
$function$;
revoke all on function private.flag_dto(uuid) from public, anon, authenticated;

-- Workspace bootstrap, invites and workshop/job rows use the verified actor
-- passed by the route, with role checks repeated inside the transaction.
create or replace function public.create_workspace_internal(
  p_actor_id uuid, p_name text, p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_workspace public.workspaces%rowtype;
  v_member public.workspace_members%rowtype;
  v_response jsonb;
begin
  if not exists (select 1 from auth.users as u where u.id = p_actor_id and u.email_confirmed_at is not null) then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if length(btrim(p_name)) not between 1 and 160 then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  v_claim := public.claim_idempotency_internal('member', p_actor_id, 'create_workspace', p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  insert into public.workspaces(name, created_by) values (btrim(p_name), p_actor_id) returning * into v_workspace;
  insert into public.workspace_members(workspace_id, user_id, role, status)
  values (v_workspace.id, p_actor_id, 'admin', 'active') returning * into v_member;
  v_response := jsonb_build_object(
    'workspace', jsonb_build_object('id', v_workspace.id, 'name', v_workspace.name, 'createdAt', v_workspace.created_at),
    'membership', jsonb_build_object('id', v_member.id, 'workspaceId', v_member.workspace_id,
      'userId', v_member.user_id, 'role', v_member.role, 'createdAt', v_member.created_at)
  );
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_response, v_workspace.id);
  return v_response;
end;
$function$;

create or replace function public.create_workspace_invite_internal(
  p_workspace_id uuid, p_actor_id uuid, p_role text, p_token_hash text,
  p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_invite public.workspace_invites%rowtype;
  v_response jsonb;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, array['admin']::text[]);
  if p_role not in ('designer', 'fabricator') or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  v_claim := public.claim_idempotency_internal('member', p_actor_id, 'create_workspace_invite:' || p_workspace_id::text, p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  insert into public.workspace_invites(workspace_id, token_hash, role, created_by, expires_at)
  values (p_workspace_id, p_token_hash, p_role, p_actor_id, clock_timestamp() + interval '7 days')
  returning * into v_invite;
  v_response := jsonb_build_object('inviteId', v_invite.id, 'createdAt', v_invite.created_at, 'expiresAt', v_invite.expires_at);
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_response, v_invite.id);
  return v_response;
end;
$function$;

create or replace function public.lookup_workspace_invite_internal(p_token_hash text)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'workspaceId', i.workspace_id,
    'workspaceName', w.name,
    'role', i.role,
    'expiresAt', i.expires_at
  )
  from public.workspace_invites as i
  join public.workspaces as w on w.id = i.workspace_id
  where i.token_hash = p_token_hash
    and i.revoked_at is null
    and i.redeemed_at is null
    and i.expires_at > clock_timestamp();
$function$;

create or replace function public.redeem_workspace_invite_internal(
  p_actor_id uuid, p_token_hash text, p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_invite public.workspace_invites%rowtype;
  v_member public.workspace_members%rowtype;
  v_response jsonb;
begin
  if not exists (select 1 from auth.users as u where u.id = p_actor_id and u.email_confirmed_at is not null) then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  v_claim := public.claim_idempotency_internal('member', p_actor_id, 'redeem_workspace_invite', p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  select * into v_invite from public.workspace_invites
  where token_hash = p_token_hash for update;
  if not found or v_invite.revoked_at is not null or v_invite.expires_at <= clock_timestamp() then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_invite.redeemed_at is not null then
    if v_invite.redeemed_by = p_actor_id then
      select * into v_member from public.workspace_members where workspace_id = v_invite.workspace_id and user_id = p_actor_id;
    else
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
  else
    insert into public.workspace_members(workspace_id, user_id, role, status, invited_by)
    values (v_invite.workspace_id, p_actor_id, v_invite.role, 'active', v_invite.created_by)
    on conflict (workspace_id, user_id) do nothing returning * into v_member;
    if v_member.id is null then raise exception 'MEMBERSHIP_EXISTS' using errcode = '23505'; end if;
    update public.workspace_invites set redeemed_by = p_actor_id, redeemed_at = clock_timestamp() where id = v_invite.id;
  end if;
  v_response := jsonb_build_object('id', v_member.id, 'workspaceId', v_member.workspace_id,
    'userId', v_member.user_id, 'role', v_member.role, 'createdAt', v_member.created_at);
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_response, v_member.id);
  return v_response;
end;
$function$;

create or replace function public.create_workshop_internal(
  p_workspace_id uuid, p_actor_id uuid, p_name text, p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_workshop public.workshops%rowtype;
  v_version public.workshop_versions%rowtype;
  v_response jsonb;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, array['fabricator']::text[]);
  if length(btrim(p_name)) not between 1 and 160 then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  v_claim := public.claim_idempotency_internal('member', p_actor_id, 'create_workshop:' || p_workspace_id::text, p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  insert into public.workshops(workspace_id, name, created_by) values (p_workspace_id, btrim(p_name), p_actor_id) returning * into v_workshop;
  insert into public.workshop_versions(workspace_id, workshop_id, version, snapshot, created_by)
  values (p_workspace_id, v_workshop.id, 1, jsonb_build_object('name', v_workshop.name, 'machines', '[]'::jsonb), p_actor_id)
  returning * into v_version;
  v_response := jsonb_build_object('id', v_version.id, 'workshopId', v_version.workshop_id,
    'workspaceId', v_version.workspace_id, 'version', v_version.version,
    'name', v_version.snapshot->'name', 'machines', v_version.snapshot->'machines', 'confirmedBy', null, 'confirmedAt', null);
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_response, v_version.id);
  return v_response;
end;
$function$;

create or replace function public.save_workshop_version_internal(
  p_workspace_id uuid, p_actor_id uuid, p_workshop_id uuid, p_expected_version integer,
  p_name text, p_machines jsonb, p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_workshop public.workshops%rowtype;
  v_version public.workshop_versions%rowtype;
  v_response jsonb;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, array['fabricator']::text[]);
  if jsonb_typeof(p_machines) <> 'array' or length(btrim(p_name)) not between 1 and 160 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  v_claim := public.claim_idempotency_internal('member', p_actor_id, 'save_workshop_version:' || p_workshop_id::text, p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  select * into v_workshop from public.workshops
  where id = p_workshop_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_workshop.current_version <> p_expected_version then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  update public.workshops set name = btrim(p_name), current_version = current_version + 1
  where id = p_workshop_id and workspace_id = p_workspace_id;
  insert into public.workshop_versions(workspace_id, workshop_id, version, snapshot, created_by)
  values (p_workspace_id, p_workshop_id, p_expected_version + 1,
    jsonb_build_object('name', btrim(p_name), 'machines', p_machines), p_actor_id)
  returning * into v_version;
  v_response := jsonb_build_object('id', v_version.id, 'workshopId', v_version.workshop_id,
    'workspaceId', v_version.workspace_id, 'version', v_version.version,
    'name', v_version.snapshot->'name', 'machines', v_version.snapshot->'machines', 'confirmedBy', null, 'confirmedAt', null);
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_response, v_version.id);
  return v_response;
end;
$function$;

create or replace function public.confirm_workshop_snapshot_internal(
  p_workspace_id uuid, p_actor_id uuid, p_workshop_id uuid, p_snapshot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_snapshot public.workshop_versions%rowtype;
  v_confirmation public.workshop_snapshot_confirmations%rowtype;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, array['fabricator']::text[]);
  select * into v_snapshot from public.workshop_versions
  where id = p_snapshot_id and workshop_id = p_workshop_id and workspace_id = p_workspace_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.workshop_snapshot_confirmations(snapshot_id, workspace_id, workshop_id, confirmed_by)
  values (p_snapshot_id, p_workspace_id, p_workshop_id, p_actor_id)
  on conflict (snapshot_id) do nothing;
  select * into v_confirmation from public.workshop_snapshot_confirmations where snapshot_id = p_snapshot_id;
  return jsonb_build_object('snapshotId', v_snapshot.id, 'confirmedBy', v_confirmation.confirmed_by,
    'confirmedAt', v_confirmation.confirmed_at);
end;
$function$;

create or replace function public.create_job_internal(
  p_workspace_id uuid, p_actor_id uuid, p_title text, p_part_number text, p_part_family text,
  p_workshop_snapshot_id uuid, p_machine_id uuid, p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_job public.jobs%rowtype;
  v_response jsonb;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, array['designer']::text[]);
  if length(btrim(p_title)) = 0 or length(btrim(p_part_number)) = 0 or length(btrim(p_part_family)) = 0
    or ((p_workshop_snapshot_id is null) <> (p_machine_id is null)) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  if p_workshop_snapshot_id is not null and not exists (
    select 1 from public.workshop_versions as v
    join public.workshop_snapshot_confirmations as c on c.snapshot_id = v.id
    where v.id = p_workshop_snapshot_id and v.workspace_id = p_workspace_id
      and exists (select 1 from jsonb_array_elements(v.snapshot->'machines') m where m->>'id' = p_machine_id::text)
  ) then raise exception 'REVIEW_REQUIRED' using errcode = '23514'; end if;
  v_claim := public.claim_idempotency_internal('member', p_actor_id, 'create_job:' || p_workspace_id::text, p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  insert into public.jobs(workspace_id, title, part_number, part_family, workshop_snapshot_id, machine_id, created_by)
  values (p_workspace_id, btrim(p_title), btrim(p_part_number), btrim(p_part_family), p_workshop_snapshot_id, p_machine_id, p_actor_id)
  returning * into v_job;
  v_response := jsonb_build_object('job', jsonb_build_object(
    'id', v_job.id, 'workspaceId', v_job.workspace_id, 'title', v_job.title,
    'partNumber', v_job.part_number, 'partFamily', v_job.part_family, 'version', v_job.version,
    'workshopSnapshotId', v_job.workshop_snapshot_id, 'machineId', v_job.machine_id,
    'sourceAssetIds', '[]'::jsonb, 'draftId', null, 'latestReleaseId', null, 'createdAt', v_job.created_at
  ));
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_response, v_job.id);
  return v_response;
end;
$function$;

create or replace function public.prepare_member_source_asset_internal(
  p_workspace_id uuid, p_actor_id uuid, p_job_id uuid, p_kind text, p_filename text,
  p_mime_type text, p_byte_size bigint, p_drawing_revision text,
  p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_asset public.assets%rowtype;
  v_response jsonb;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, array['designer']::text[]);
  if p_kind not in ('drawing_pdf', 'model_glb', 'bend_manifest') or p_byte_size not between 1 and 52428800
    or length(btrim(p_filename)) = 0 or length(btrim(p_mime_type)) = 0 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  if not exists (select 1 from public.jobs where id = p_job_id and workspace_id = p_workspace_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_claim := public.claim_idempotency_internal('member', p_actor_id, 'prepare_member_source_asset:' || p_job_id::text, p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  insert into public.assets(workspace_id, job_id, kind, filename, mime_type, byte_size, storage_key, uploaded_by_user_id, drawing_revision)
  values (p_workspace_id, p_job_id, p_kind, btrim(p_filename), lower(btrim(p_mime_type)), p_byte_size,
    'workspaces/' || p_workspace_id::text || '/jobs/' || p_job_id::text || '/assets/' || gen_random_uuid()::text || '/blob',
    p_actor_id, p_drawing_revision)
  returning * into v_asset;
  -- The key is canonicalised to the generated asset ID before its row is committed.
  update public.assets set storage_key = 'workspaces/' || p_workspace_id::text || '/jobs/' || p_job_id::text || '/assets/' || v_asset.id::text || '/blob'
  where id = v_asset.id returning * into v_asset;
  v_response := private.asset_dto(v_asset);
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_response, v_asset.id);
  return v_response;
end;
$function$;

create or replace function public.create_release_access_link_internal(
  p_workspace_id uuid, p_actor_id uuid, p_release_id uuid, p_token_hash text,
  p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_link public.release_access_links%rowtype;
  v_response jsonb;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, array['designer']::text[]);
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  if not exists (select 1 from public.releases where id = p_release_id and workspace_id = p_workspace_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_claim := public.claim_idempotency_internal('member', p_actor_id, 'create_release_access_link:' || p_release_id::text, p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  insert into public.release_access_links(workspace_id, job_id, release_id, token_hash, created_by)
  select r.workspace_id, r.job_id, r.id, p_token_hash, p_actor_id from public.releases as r
  where r.id = p_release_id and r.workspace_id = p_workspace_id returning * into v_link;
  v_response := jsonb_build_object('linkId', v_link.id, 'releaseId', v_link.release_id);
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_response, v_link.id);
  return v_response;
end;
$function$;

create or replace function public.revoke_release_access_link_internal(
  p_workspace_id uuid, p_actor_id uuid, p_release_id uuid, p_link_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_link public.release_access_links%rowtype;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, array['designer']::text[]);
  update public.release_access_links set revoked_at = coalesce(revoked_at, clock_timestamp())
  where id = p_link_id and release_id = p_release_id and workspace_id = p_workspace_id returning * into v_link;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('linkId', v_link.id, 'revokedAt', v_link.revoked_at);
end;
$function$;

create or replace function public.exchange_release_access_link_internal(
  p_link_token_hash text, p_session_token_hash text, p_display_name text, p_session_ttl_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_link public.release_access_links%rowtype;
  v_session public.release_visitor_sessions%rowtype;
  v_release public.releases%rowtype;
begin
  if p_link_token_hash !~ '^[0-9a-f]{64}$' or p_session_token_hash !~ '^[0-9a-f]{64}$'
     or length(btrim(p_display_name)) not between 1 and 120 then
    raise exception 'RELEASE_REVOKED' using errcode = '42501';
  end if;
  select * into v_link from public.release_access_links
  where token_hash = p_link_token_hash and revoked_at is null for update;
  if not found then raise exception 'RELEASE_REVOKED' using errcode = '42501'; end if;
  select * into v_release from public.releases where id = v_link.release_id;
  insert into public.release_visitor_sessions(access_link_id, session_token_hash, display_name, expires_at)
  values (v_link.id, p_session_token_hash, btrim(p_display_name),
    clock_timestamp() + make_interval(secs => greatest(300, least(coalesce(p_session_ttl_seconds, 28800), 86400))))
  returning * into v_session;
  insert into public.release_visitor_session_grants(
    workspace_id, job_id, session_id, origin_release_id, origin_access_link_id, release_id, grant_kind
  ) values (v_link.workspace_id, v_link.job_id, v_session.id, v_link.release_id, v_link.id, v_link.release_id, 'original_link');
  return jsonb_build_object('sessionId', v_session.id, 'releaseId', v_link.release_id,
    'accessLinkId', v_link.id, 'displayName', v_session.display_name,
    'workspaceId', v_link.workspace_id, 'jobId', v_link.job_id, 'expiresAt', v_session.expires_at);
end;
$function$;

create or replace function public.resolve_release_visitor_session_internal(p_session_token_hash text, p_release_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select private.release_visitor_scope(s.id, p_release_id)
  from public.release_visitor_sessions as s
  where s.session_token_hash = p_session_token_hash;
$function$;

create or replace function public.resolve_visitor_flag_scope_internal(p_session_token_hash text, p_flag_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select private.release_visitor_scope(s.id, f.release_id) || jsonb_build_object('flagId', f.id)
  from public.release_visitor_sessions as s
  join public.flags as f on f.id = p_flag_id
  where s.session_token_hash = p_session_token_hash;
$function$;

create or replace function public.resolve_visitor_asset_scope_internal(p_session_token_hash text, p_asset_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  with session as (
    select s.* from public.release_visitor_sessions as s
    join public.release_access_links as l on l.id = s.access_link_id
    where s.session_token_hash = p_session_token_hash and s.revoked_at is null
      and s.expires_at > clock_timestamp() and l.revoked_at is null
  ), allowed as (
    select g.release_id, g.workspace_id, g.job_id, s.id as session_id, s.access_link_id, s.display_name, s.expires_at,
      case when a.kind = 'issue_photo' then 'issue_photo' else 'source' end as asset_kind,
      case when g.grant_kind = 'original_link' then 0 else 1 end as grant_order
    from session as s
    join public.release_visitor_session_grants as g on g.session_id = s.id
    join public.assets as a on a.id = p_asset_id and a.job_id = g.job_id and a.workspace_id = g.workspace_id
      and a.status = 'ready'
    where (a.kind <> 'issue_photo' and a.release_id is null and exists (
      select 1 from public.release_assets as ra where ra.release_id = g.release_id and ra.asset_id = a.id
    )) or (a.kind = 'issue_photo' and a.release_id = g.release_id and exists (
      select 1 from public.flag_photo_assets as fp where fp.release_id = g.release_id and fp.asset_id = a.id
    ))
    union all
    select a.release_id, a.workspace_id, a.job_id, s.id, s.access_link_id, s.display_name, s.expires_at,
      'issue_photo', 2
    from session as s
    join public.assets as a on a.id = p_asset_id and a.release_id is not null
      and a.uploaded_by_visitor_session_id = s.id and a.status = 'ready'
    where not exists (select 1 from public.flag_photo_assets as fp where fp.asset_id = a.id)
  )
  select jsonb_build_object('sessionId', session_id, 'releaseId', release_id,
    'accessLinkId', access_link_id, 'displayName', display_name,
    'workspaceId', workspace_id, 'jobId', job_id, 'expiresAt', expires_at,
    'assetId', p_asset_id, 'assetKind', asset_kind)
  from allowed order by grant_order limit 1;
$function$;

create or replace function public.require_live_release_session_internal(p_session_id uuid, p_release_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  select private.release_visitor_scope(p_session_id, p_release_id) is not null;
$function$;

create or replace function public.lookup_live_release_successor_internal(p_session_id uuid, p_release_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select case when private.release_visitor_scope(p_session_id, p_release_id) is null then null
    else coalesce((
      select jsonb_build_object('releaseId', target.id, 'canFollow', target.allow_predecessor_visitors)
      from public.releases as target
      join public.release_visitor_sessions as s on s.id = p_session_id
      join public.release_access_links as l on l.id = s.access_link_id and l.revoked_at is null
      where target.supersedes_release_id = p_release_id
        and target.allow_predecessor_visitors
        and target.job_id = (select r.job_id from public.releases r where r.id = p_release_id)
      order by target.revision_number desc limit 1
    ), jsonb_build_object('releaseId', null, 'canFollow', false))
  end;
$function$;

create or replace function public.follow_release_replacement_internal(
  p_session_id uuid, p_current_release_id uuid, p_replacement_release_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_scope jsonb;
  v_target public.releases%rowtype;
  v_job_id uuid;
begin
  v_scope := private.release_visitor_scope(p_session_id, p_current_release_id);
  if v_scope is null then raise exception 'RELEASE_REVOKED' using errcode = '42501'; end if;
  v_job_id := (v_scope->>'jobId')::uuid;
  select * into v_target from public.releases
  where id = p_replacement_release_id and job_id = v_job_id
    and supersedes_release_id = p_current_release_id and allow_predecessor_visitors
  for share;
  if not found then raise exception 'RELEASE_REVOKED' using errcode = '42501'; end if;
  insert into public.release_visitor_session_grants(
    workspace_id, job_id, session_id, origin_release_id, origin_access_link_id, release_id, grant_kind
  ) values ((v_scope->>'workspaceId')::uuid, v_job_id, p_session_id,
    p_current_release_id, (v_scope->>'accessLinkId')::uuid, p_replacement_release_id, 'explicit_replacement_follow')
  on conflict (session_id, release_id) do nothing;
  return jsonb_build_object('releaseId', p_replacement_release_id);
end;
$function$;

-- Service-role-only RPC grants are consolidated at the end of this migration.

create or replace function private.context_matches_content(p_context jsonb, p_content jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_step_id text := p_context->>'stepId';
  v_bend_id text := p_context->>'bendId';
begin
  if jsonb_typeof(p_context) <> 'object' or jsonb_typeof(p_content) <> 'object'
     or ((p_context->>'releaseId' is null) = (p_context->>'draftId' is null)) then
    return false;
  end if;
  if (p_context->>'draftId' is null and p_context->>'draftVersion' is not null)
     or (p_context->>'draftId' is not null and p_context->>'draftVersion' is null) then
    return false;
  end if;
  if v_step_id is not null and not exists (
    select 1 from jsonb_array_elements(coalesce(p_content->'steps', '[]'::jsonb)) as step
    where step->>'id' = v_step_id and (v_bend_id is null or step->>'bendId' = v_bend_id)
  ) then return false; end if;
  if v_bend_id is not null and not exists (
    select 1 from jsonb_array_elements(coalesce(p_content->'bends', '[]'::jsonb)) as bend
    where bend->>'bendId' = v_bend_id
  ) then return false; end if;
  return true;
exception when others then
  return false;
end;
$function$;
revoke all on function private.context_matches_content(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.ask_member_question_internal(
  p_workspace_id uuid, p_actor_id uuid, p_context jsonb, p_question text,
  p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_job_id uuid := (p_context->>'jobId')::uuid;
  v_release_id uuid := nullif(p_context->>'releaseId', '')::uuid;
  v_draft_id uuid := nullif(p_context->>'draftId', '')::uuid;
  v_content jsonb;
  v_draft public.drafts%rowtype;
  v_release public.releases%rowtype;
  v_question public.questions%rowtype;
  v_response jsonb;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, null);
  if length(btrim(p_question)) not between 1 and 4000 then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  if not exists (select 1 from public.jobs where id = v_job_id and workspace_id = p_workspace_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_release_id is not null then
    select * into v_release from public.releases where id = v_release_id and job_id = v_job_id and workspace_id = p_workspace_id;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    v_content := v_release.snapshot;
  else
    select * into v_draft from public.drafts where id = v_draft_id and job_id = v_job_id and workspace_id = p_workspace_id for share;
    if not found or v_draft.version <> (p_context->>'draftVersion')::integer
       or not exists (select 1 from public.jobs j where j.id = v_job_id and j.current_draft_id = v_draft.id) then
      raise exception 'VERSION_CONFLICT' using errcode = '40001';
    end if;
    v_content := v_draft.content;
  end if;
  if not private.context_matches_content(p_context, v_content) then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  v_claim := public.claim_idempotency_internal('member', p_actor_id,
    'ask_question:' || p_workspace_id::text || ':' || v_job_id::text, p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  insert into public.questions(
    workspace_id, job_id, release_id, draft_id, draft_version, step_id, bend_id,
    question, actor_kind, actor_user_id, idempotency_record_id
  ) values (
    p_workspace_id, v_job_id, v_release_id, v_draft_id, nullif(p_context->>'draftVersion', '')::integer,
    nullif(p_context->>'stepId', '')::uuid, nullif(p_context->>'bendId', ''), btrim(p_question),
    'member', p_actor_id, (v_claim->>'recordId')::uuid
  ) returning * into v_question;
  v_response := jsonb_build_object('questionId', v_question.id, 'context', p_context,
    'createdAt', v_question.created_at, 'answer', null);
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_response, v_question.id);
  return v_response;
end;
$function$;

create or replace function public.ask_release_question_internal(
  p_session_id uuid, p_release_id uuid, p_context jsonb, p_question text,
  p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_scope jsonb;
  v_release public.releases%rowtype;
  v_claim jsonb;
  v_limit jsonb;
  v_question public.questions%rowtype;
  v_response jsonb;
begin
  v_scope := private.release_visitor_scope(p_session_id, p_release_id);
  if v_scope is null then raise exception 'RELEASE_REVOKED' using errcode = '42501'; end if;
  if (p_context->>'releaseId')::uuid is distinct from p_release_id
     or (p_context->>'jobId')::uuid is distinct from (v_scope->>'jobId')::uuid
     or p_context->>'draftId' is not null or p_context->>'draftVersion' is not null
     or length(btrim(p_question)) not between 1 and 4000 then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_release from public.releases where id = p_release_id and job_id = (v_scope->>'jobId')::uuid;
  if not found or not private.context_matches_content(p_context, v_release.snapshot) then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  v_claim := public.claim_idempotency_internal('release_visitor', p_session_id,
    'ask_release_question:' || p_release_id::text, p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  v_limit := public.consume_visitor_rate_limit_internal(p_session_id, p_release_id, 'question');
  if coalesce((v_limit->>'allowed')::boolean, false) is not true then
    raise exception 'RATE_LIMITED' using errcode = 'P0001', detail = coalesce(v_limit->>'retryAfterSeconds', '1');
  end if;
  insert into public.questions(
    workspace_id, job_id, release_id, step_id, bend_id, question, actor_kind, actor_session_id, idempotency_record_id
  ) values (
    (v_scope->>'workspaceId')::uuid, (v_scope->>'jobId')::uuid, p_release_id,
    nullif(p_context->>'stepId', '')::uuid, nullif(p_context->>'bendId', ''), btrim(p_question),
    'release_visitor', p_session_id, (v_claim->>'recordId')::uuid
  ) returning * into v_question;
  v_response := jsonb_build_object('questionId', v_question.id, 'context', p_context,
    'createdAt', v_question.created_at, 'answer', null);
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_response, v_question.id);
  return v_response;
end;
$function$;

create or replace function private.persist_question_answer(
  p_question public.questions, p_answer jsonb, p_model_identifier text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_answer jsonb;
begin
  if length(btrim(p_model_identifier)) not between 1 and 200 then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  if p_answer->>'id' is distinct from p_question.id::text then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  if p_question.release_id is not null then
    if (p_answer#>>'{context,releaseId}') is distinct from p_question.release_id::text then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  elsif (p_answer#>>'{context,draftId}') is distinct from p_question.draft_id::text
    or (p_answer#>>'{context,draftVersion}')::integer is distinct from p_question.draft_version then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_question.answer is not null then
    if p_question.answer is distinct from p_answer or p_question.model_identifier is distinct from btrim(p_model_identifier) then
      raise exception 'VERSION_CONFLICT' using errcode = '40001';
    end if;
    return p_question.answer;
  end if;
  update public.questions set answer = p_answer, model_identifier = btrim(p_model_identifier)
  where id = p_question.id;
  update public.idempotency_records
  set response = response || jsonb_build_object('answer', p_answer), updated_at = clock_timestamp()
  where id = p_question.idempotency_record_id and state = 'completed';
  return p_answer;
end;
$function$;

create or replace function public.complete_member_question_internal(
  p_workspace_id uuid, p_actor_id uuid, p_question_id uuid, p_answer jsonb, p_model_identifier text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_question public.questions%rowtype;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, null);
  select * into v_question from public.questions
  where id = p_question_id and workspace_id = p_workspace_id and actor_kind = 'member' and actor_user_id = p_actor_id
  for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return private.persist_question_answer(v_question, p_answer, p_model_identifier);
end;
$function$;

create or replace function public.complete_visitor_question_internal(
  p_session_id uuid, p_release_id uuid, p_question_id uuid, p_answer jsonb, p_model_identifier text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_question public.questions%rowtype;
begin
  if private.release_visitor_scope(p_session_id, p_release_id) is null then raise exception 'RELEASE_REVOKED' using errcode = '42501'; end if;
  select * into v_question from public.questions
  where id = p_question_id and release_id = p_release_id and actor_kind = 'release_visitor' and actor_session_id = p_session_id
  for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return private.persist_question_answer(v_question, p_answer, p_model_identifier);
end;
$function$;

create or replace function public.list_release_flags_internal(p_session_id uuid, p_release_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_scope jsonb;
begin
  v_scope := private.release_visitor_scope(p_session_id, p_release_id);
  if v_scope is null then raise exception 'RELEASE_REVOKED' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(private.flag_dto(f.id) order by f.created_at desc)
    from public.flags as f
    where f.workspace_id = (v_scope->>'workspaceId')::uuid
      and f.job_id = (v_scope->>'jobId')::uuid
      and f.release_id = p_release_id
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.create_member_release_flag_internal(
  p_workspace_id uuid, p_actor_id uuid, p_release_id uuid, p_context jsonb,
  p_question text, p_photo_asset_ids jsonb, p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text;
  v_release public.releases%rowtype;
  v_claim jsonb;
  v_flag public.flags%rowtype;
  v_ids integer;
  v_distinct integer;
  v_name text;
begin
  v_role := private.require_member_role(p_workspace_id, p_actor_id, null);
  if (p_context->>'releaseId')::uuid is distinct from p_release_id or p_context->>'draftId' is not null
     or length(btrim(p_question)) not between 1 and 2000 or jsonb_typeof(p_photo_asset_ids) <> 'array' then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  select * into v_release from public.releases where id = p_release_id and workspace_id = p_workspace_id;
  if not found or not private.context_matches_content(p_context, v_release.snapshot) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select count(*), count(distinct e.value::uuid) into v_ids, v_distinct from jsonb_array_elements_text(p_photo_asset_ids) e(value);
  if v_ids <> v_distinct then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements_text(p_photo_asset_ids) e(value)
    left join public.assets a on a.id = e.value::uuid and a.workspace_id = p_workspace_id and a.job_id = v_release.job_id and a.release_id = p_release_id
    where a.id is null or a.kind <> 'issue_photo' or a.status <> 'ready') then
    raise exception 'UNSUPPORTED_ASSET' using errcode = '23514';
  end if;
  v_claim := public.claim_idempotency_internal('member', p_actor_id, 'create_release_flag:' || p_release_id::text, p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  select display_name into v_name from public.user_profiles where user_id = p_actor_id;
  insert into public.flags(workspace_id, job_id, release_id, step_id, bend_id, question,
    created_by_kind, created_by_user_id, created_by_display_name)
  values (p_workspace_id, v_release.job_id, p_release_id, nullif(p_context->>'stepId', '')::uuid,
    nullif(p_context->>'bendId', ''), btrim(p_question), 'member', p_actor_id, coalesce(nullif(btrim(v_name), ''), 'Member'))
  returning * into v_flag;
  insert into public.flag_photo_assets(workspace_id, job_id, release_id, flag_id, asset_id)
  select p_workspace_id, v_release.job_id, p_release_id, v_flag.id, e.value::uuid from jsonb_array_elements_text(p_photo_asset_ids) e(value);
  v_name := private.flag_dto(v_flag.id)::text;
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_name::jsonb, v_flag.id);
  return v_name::jsonb;
end;
$function$;

create or replace function public.create_release_flag_internal(
  p_session_id uuid, p_release_id uuid, p_context jsonb, p_question text,
  p_photo_asset_ids jsonb, p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_scope jsonb;
  v_release public.releases%rowtype;
  v_claim jsonb;
  v_limit jsonb;
  v_flag public.flags%rowtype;
  v_response jsonb;
  v_ids integer;
  v_distinct integer;
begin
  v_scope := private.release_visitor_scope(p_session_id, p_release_id);
  if v_scope is null then raise exception 'RELEASE_REVOKED' using errcode = '42501'; end if;
  if (p_context->>'releaseId')::uuid is distinct from p_release_id
     or (p_context->>'jobId')::uuid is distinct from (v_scope->>'jobId')::uuid
     or length(btrim(p_question)) not between 1 and 2000 or jsonb_typeof(p_photo_asset_ids) <> 'array' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_release from public.releases where id = p_release_id and job_id = (v_scope->>'jobId')::uuid;
  if not found or not private.context_matches_content(p_context, v_release.snapshot) then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  select count(*), count(distinct e.value::uuid) into v_ids, v_distinct from jsonb_array_elements_text(p_photo_asset_ids) e(value);
  if v_ids <> v_distinct then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements_text(p_photo_asset_ids) e(value)
    left join public.assets a on a.id = e.value::uuid and a.workspace_id = (v_scope->>'workspaceId')::uuid and a.job_id = v_release.job_id and a.release_id = p_release_id
      and a.uploaded_by_visitor_session_id = p_session_id
    where a.id is null or a.kind <> 'issue_photo' or a.status <> 'ready') then
    raise exception 'UNSUPPORTED_ASSET' using errcode = '23514';
  end if;
  v_claim := public.claim_idempotency_internal('release_visitor', p_session_id,
    'create_release_flag:' || p_release_id::text, p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  v_limit := public.consume_visitor_rate_limit_internal(p_session_id, p_release_id, 'flag');
  if coalesce((v_limit->>'allowed')::boolean, false) is not true then raise exception 'RATE_LIMITED' using errcode = 'P0001'; end if;
  insert into public.flags(workspace_id, job_id, release_id, step_id, bend_id, question,
    created_by_kind, created_by_session_id, created_by_display_name)
  values ((v_scope->>'workspaceId')::uuid, v_release.job_id, p_release_id,
    nullif(p_context->>'stepId', '')::uuid, nullif(p_context->>'bendId', ''), btrim(p_question),
    'release_visitor', p_session_id, v_scope->>'displayName') returning * into v_flag;
  insert into public.flag_photo_assets(workspace_id, job_id, release_id, flag_id, asset_id)
  select (v_scope->>'workspaceId')::uuid, v_release.job_id, p_release_id, v_flag.id, e.value::uuid from jsonb_array_elements_text(p_photo_asset_ids) e(value);
  v_response := private.flag_dto(v_flag.id);
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_response, v_flag.id);
  return v_response;
end;
$function$;

create or replace function public.respond_to_flag_internal(
  p_workspace_id uuid, p_actor_id uuid, p_flag_id uuid, p_expected_version integer,
  p_text text, p_kind text, p_replacement_release_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_flag public.flags%rowtype;
  v_job public.jobs%rowtype;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, array['designer']::text[]);
  if length(btrim(p_text)) not between 1 and 3000 or p_kind not in ('explanation', 'replacement_release')
    or ((p_kind = 'replacement_release') <> (p_replacement_release_id is not null)) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  select * into v_flag from public.flags where id = p_flag_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_flag.version <> p_expected_version then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  if p_kind = 'replacement_release' then
    select * into v_job from public.jobs where id = v_flag.job_id and workspace_id = p_workspace_id for update;
    if not found or not exists (select 1 from public.releases r where r.id = p_replacement_release_id
      and r.job_id = v_flag.job_id and r.supersedes_release_id = v_flag.release_id
      and r.id = v_job.latest_release_id) then
      raise exception 'VERSION_CONFLICT' using errcode = '40001';
    end if;
  end if;
  insert into public.flag_responses(workspace_id, job_id, release_id, flag_id, flag_version,
    text, author_id, kind, replacement_release_id)
  values (v_flag.workspace_id, v_flag.job_id, v_flag.release_id, v_flag.id, v_flag.version + 1,
    btrim(p_text), p_actor_id, p_kind, p_replacement_release_id);
  update public.flags set version = version + 1, status = 'responded'
  where id = v_flag.id and workspace_id = p_workspace_id;
  return private.flag_dto(v_flag.id);
end;
$function$;

create or replace function public.acknowledge_flag_internal(
  p_actor_kind text, p_actor_id uuid, p_release_id uuid, p_flag_id uuid, p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_scope jsonb;
  v_flag public.flags%rowtype;
  v_user_id uuid;
  v_session_id uuid;
  v_workspace_id uuid;
begin
  if p_actor_kind = 'release_visitor' then
    v_scope := private.release_visitor_scope(p_actor_id, p_release_id);
    if v_scope is null then raise exception 'RELEASE_REVOKED' using errcode = '42501'; end if;
    v_session_id := p_actor_id;
  elsif p_actor_kind = 'member' then
    select f.workspace_id into v_workspace_id from public.flags f where f.id = p_flag_id and f.release_id = p_release_id;
    if v_workspace_id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    perform private.require_member_role(v_workspace_id, p_actor_id, null);
    v_user_id := p_actor_id;
  else raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  select * into v_flag from public.flags where id = p_flag_id and release_id = p_release_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_flag.version <> p_expected_version then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  insert into public.acknowledgements(workspace_id, job_id, release_id, flag_id, flag_version,
    actor_kind, actor_user_id, actor_session_id)
  values (v_flag.workspace_id, v_flag.job_id, v_flag.release_id, v_flag.id, v_flag.version,
    p_actor_kind, v_user_id, v_session_id) on conflict do nothing;
  return private.flag_dto(v_flag.id);
end;
$function$;

create or replace function public.prepare_visitor_photo_internal(
  p_session_id uuid, p_release_id uuid, p_filename text, p_mime_type text,
  p_byte_size bigint, p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_scope jsonb;
  v_claim jsonb;
  v_asset public.assets%rowtype;
  v_asset_id uuid := gen_random_uuid();
  v_response jsonb;
begin
  v_scope := private.release_visitor_scope(p_session_id, p_release_id);
  if v_scope is null then raise exception 'RELEASE_REVOKED' using errcode = '42501'; end if;
  if lower(p_mime_type) not in ('image/jpeg', 'image/png', 'image/webp')
     or p_byte_size not between 1 and 10485760 or length(btrim(p_filename)) = 0 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  v_claim := public.claim_idempotency_internal('release_visitor', p_session_id,
    'prepare_visitor_photo:' || p_release_id::text, p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  insert into public.assets(id, workspace_id, job_id, release_id, kind, filename, mime_type, byte_size,
    storage_key, uploaded_by_visitor_session_id)
  values (v_asset_id, (v_scope->>'workspaceId')::uuid, (v_scope->>'jobId')::uuid, p_release_id,
    'issue_photo', btrim(p_filename), lower(btrim(p_mime_type)), p_byte_size,
    'workspaces/' || (v_scope->>'workspaceId') || '/jobs/' || (v_scope->>'jobId') || '/assets/' || v_asset_id::text || '/blob',
    p_session_id) returning * into v_asset;
  v_response := private.asset_dto(v_asset);
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_response, v_asset.id);
  return v_response;
end;
$function$;

create or replace function public.record_draft_clarification_internal(
  p_workspace_id uuid, p_job_id uuid, p_actor_id uuid, p_text text,
  p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_job public.jobs%rowtype;
  v_note public.review_notes%rowtype;
  v_response jsonb;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, array['designer']::text[]);
  if length(btrim(p_text)) not between 1 and 3000 then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  v_claim := public.claim_idempotency_internal('member', p_actor_id, 'record_draft_clarification:' || p_job_id::text, p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  select * into v_job from public.jobs where id = p_job_id and workspace_id = p_workspace_id for update;
  if not found or v_job.current_draft_id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.review_notes(workspace_id, job_id, draft_id, author_id, text)
  values (p_workspace_id, p_job_id, v_job.current_draft_id, p_actor_id, btrim(p_text)) returning * into v_note;
  v_response := jsonb_build_object('recordId', v_note.id, 'createdAt', v_note.created_at);
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_response, v_note.id);
  return v_response;
end;
$function$;

create or replace function public.create_draft_from_release_internal(
  p_workspace_id uuid, p_job_id uuid, p_release_id uuid, p_actor_id uuid,
  p_expected_job_version integer, p_expected_draft_version integer,
  p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim jsonb;
  v_job public.jobs%rowtype;
  v_release public.releases%rowtype;
  v_draft public.drafts%rowtype;
  v_fingerprint text;
  v_version integer;
  v_result jsonb;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, array['designer']::text[]);
  v_claim := public.claim_idempotency_internal('member', p_actor_id, 'create_draft_from_release:' || p_job_id::text, p_idempotency_key, p_payload_hash, 120);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  select * into v_job from public.jobs where id = p_job_id and workspace_id = p_workspace_id for update;
  if not found or v_job.version <> p_expected_job_version then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  if v_job.current_draft_id is null then
    if p_expected_draft_version is not null then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  else
    select * into v_draft from public.drafts where id = v_job.current_draft_id for update;
    if not found or v_draft.version <> p_expected_draft_version then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  end if;
  select * into v_release from public.releases where id = p_release_id and job_id = p_job_id and workspace_id = p_workspace_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.workshop_snapshot_id is distinct from (v_release.snapshot->>'workshopSnapshotId')::uuid
    or v_job.machine_id is distinct from (v_release.snapshot->>'machineId')::uuid
    or exists (select 1 from (
      (select jsonb_array_elements_text(coalesce(v_release.snapshot->'sourceAssetIds','[]'::jsonb)) as asset_id)
      except
      (select jsa.asset_id::text from public.job_source_assets jsa where jsa.workspace_id = p_workspace_id and jsa.job_id = p_job_id)
    ) x) or exists (select 1 from (
      (select jsa.asset_id::text from public.job_source_assets jsa where jsa.workspace_id = p_workspace_id and jsa.job_id = p_job_id)
      except
      (select jsonb_array_elements_text(coalesce(v_release.snapshot->'sourceAssetIds','[]'::jsonb)) as asset_id)
    ) x) then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  v_fingerprint := private.current_job_input_fingerprint(p_workspace_id, p_job_id);
  if v_fingerprint is null then raise exception 'REVIEW_REQUIRED' using errcode = '23514'; end if;
  v_version := coalesce(v_draft.version, 0) + 1;
  if v_job.current_draft_id is null then
    insert into public.drafts(workspace_id, job_id, version, content, generation_id, input_fingerprint, created_by)
    values (p_workspace_id, p_job_id, 1, v_release.snapshot, null, v_fingerprint, p_actor_id) returning * into v_draft;
  else
    update public.drafts set version = v_version, content = v_release.snapshot,
      generation_id = null, input_fingerprint = v_fingerprint, updated_at = clock_timestamp()
    where id = v_job.current_draft_id returning * into v_draft;
  end if;
  update public.jobs set current_draft_id = v_draft.id where id = p_job_id and workspace_id = p_workspace_id;
  v_result := private.draft_dto(v_draft.id, p_workspace_id);
  perform private.complete_idempotency((v_claim->>'recordId')::uuid, (v_claim->>'claimToken')::uuid, v_result, v_draft.id);
  return v_result;
end;
$function$;

create or replace function public.resolve_draft_finding_internal(
  p_workspace_id uuid, p_job_id uuid, p_actor_id uuid, p_finding_id uuid,
  p_expected_version integer, p_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.jobs%rowtype;
  v_draft public.drafts%rowtype;
  v_finding jsonb;
  v_content jsonb;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, array['designer']::text[]);
  select * into v_job from public.jobs where id = p_job_id and workspace_id = p_workspace_id for update;
  if not found or v_job.current_draft_id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_draft from public.drafts where id = v_job.current_draft_id for update;
  if v_draft.version <> p_expected_version then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  if not exists (select 1 from public.review_notes where id = p_record_id and workspace_id = p_workspace_id and job_id = p_job_id and draft_id = v_draft.id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select finding into v_finding from jsonb_array_elements(coalesce(v_draft.content->'findings','[]'::jsonb)) finding
  where finding->>'id' = p_finding_id::text;
  if v_finding is null or v_finding->>'disposition' <> 'open' then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  v_content := jsonb_set(v_draft.content, '{findings}', coalesce((
    select jsonb_agg(case when finding->>'id' = p_finding_id::text then finding || jsonb_build_object('disposition','resolved','resolutionRecordId',p_record_id) else finding end)
    from jsonb_array_elements(coalesce(v_draft.content->'findings','[]'::jsonb)) finding
  ), '[]'::jsonb), true);
  if jsonb_typeof(v_content->'panelModel') = 'object' then v_content := jsonb_set(v_content, '{panelModel,reviewed}', 'false'::jsonb, true); end if;
  update public.drafts set content = v_content, version = version + 1, updated_at = clock_timestamp()
  where id = v_draft.id and version = p_expected_version;
  return private.draft_dto(v_draft.id, p_workspace_id);
end;
$function$;

create or replace function public.decide_machine_proposal_internal(
  p_workspace_id uuid, p_job_id uuid, p_actor_id uuid, p_proposal_id uuid,
  p_expected_version integer, p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.jobs%rowtype;
  v_draft public.drafts%rowtype;
  v_content jsonb;
  v_proposal jsonb;
  v_order text[];
  v_step_count integer;
begin
  perform private.require_member_role(p_workspace_id, p_actor_id, array['fabricator']::text[]);
  if p_decision not in ('accept','reject') then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  select * into v_job from public.jobs where id = p_job_id and workspace_id = p_workspace_id for update;
  if not found or v_job.current_draft_id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_draft from public.drafts where id = v_job.current_draft_id for update;
  if v_draft.version <> p_expected_version then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  select proposal into v_proposal from jsonb_array_elements(coalesce(v_draft.content->'machineProposals','[]'::jsonb)) proposal
  where proposal->>'id' = p_proposal_id::text;
  if v_proposal is null or v_proposal->>'status' <> 'proposed' then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  select array_agg(value order by ordinality) into v_order
  from jsonb_array_elements_text(v_proposal->'proposedBendOrder') with ordinality;
  select count(*) into v_step_count from jsonb_array_elements(coalesce(v_draft.content->'steps','[]'::jsonb));
  if p_decision = 'accept' and (
    cardinality(v_order) is distinct from (select count(*) from jsonb_array_elements(coalesce(v_draft.content->'bends','[]'::jsonb)))
    or exists (select value from unnest(v_order) x(value) group by value having count(*) > 1)
    or exists (select 1 from unnest(v_order) x(value) where not exists (
      select 1 from jsonb_array_elements(coalesce(v_draft.content->'bends','[]'::jsonb)) b where b->>'bendId' = x.value
    ))
  ) then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  v_content := jsonb_set(v_draft.content, '{machineProposals}', coalesce((
    select jsonb_agg(case when proposal->>'id' = p_proposal_id::text then proposal || jsonb_build_object(
      'status', case when p_decision = 'accept' then 'accepted' else 'rejected' end, 'decidedBy', p_actor_id
    ) else proposal end)
    from jsonb_array_elements(coalesce(v_draft.content->'machineProposals','[]'::jsonb)) proposal
  ), '[]'::jsonb), true);
  if p_decision = 'accept' then
    v_content := jsonb_set(v_content, '{steps}', coalesce((
      select jsonb_agg(step order by coalesce(array_position(v_order, step->>'bendId'), 2147483647), step->>'id')
      from jsonb_array_elements(coalesce(v_content->'steps','[]'::jsonb)) step
    ), '[]'::jsonb), true);
  end if;
  update public.drafts set content = v_content, version = version + 1, updated_at = clock_timestamp()
  where id = v_draft.id and version = p_expected_version;
  return private.draft_dto(v_draft.id, p_workspace_id);
end;
$function$;

create or replace function public.review_draft_internal(
  p_workspace_id uuid, p_job_id uuid, p_actor_id uuid, p_expected_version integer, p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.jobs%rowtype;
  v_draft public.drafts%rowtype;
  v_content jsonb;
begin
  if p_kind not in ('design','process') then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  if p_kind = 'design' then perform private.require_member_role(p_workspace_id,p_actor_id,array['designer']::text[]);
  else perform private.require_member_role(p_workspace_id,p_actor_id,array['fabricator']::text[]); end if;
  select * into v_job from public.jobs where id = p_job_id and workspace_id = p_workspace_id for update;
  if not found or v_job.current_draft_id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_draft from public.drafts where id = v_job.current_draft_id and workspace_id = p_workspace_id for update;
  if not found or v_draft.version <> p_expected_version then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  if private.current_job_input_fingerprint(p_workspace_id,p_job_id) is distinct from v_draft.input_fingerprint then raise exception 'REVIEW_REQUIRED' using errcode = '23514'; end if;
  if v_job.workshop_snapshot_id is null or v_job.machine_id is null or not exists (
    select 1 from public.workshop_snapshot_confirmations wc where wc.snapshot_id = v_job.workshop_snapshot_id
  ) then raise exception 'REVIEW_REQUIRED' using errcode = '23514'; end if;
  if p_kind = 'design' then
    if v_draft.content->'panelModel' is null or v_draft.content->'panelModel' = 'null'::jsonb then raise exception 'REVIEW_REQUIRED' using errcode = '23514'; end if;
    v_content := jsonb_set(v_draft.content, '{panelModel,reviewed}', 'true'::jsonb, true);
    update public.drafts set content = v_content, updated_at = clock_timestamp() where id = v_draft.id;
  end if;
  insert into public.draft_reviews(workspace_id,job_id,draft_id,kind,actor_id,draft_version)
  values (p_workspace_id,p_job_id,v_draft.id,p_kind,p_actor_id,v_draft.version)
  on conflict (draft_id,draft_version,kind) do nothing;
  if not exists (select 1 from public.draft_reviews where draft_id = v_draft.id and draft_version = v_draft.version and kind = p_kind) then
    raise exception 'REVIEW_REQUIRED' using errcode = '23514';
  end if;
  return jsonb_build_object('draftId',v_draft.id);
end;
$function$;

create or replace function public.start_generation_internal(
  p_workspace_id uuid, p_job_id uuid, p_actor_id uuid, p_expected_job_version integer,
  p_idempotency_key text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.jobs%rowtype;
  v_draft public.drafts%rowtype;
  v_generation public.generations%rowtype;
  v_claim jsonb;
  v_fingerprint text;
  v_ready_count integer;
  v_source_count integer;
  v_result jsonb;
begin
  perform private.require_member_role(p_workspace_id,p_actor_id,array['designer']::text[]);
  select * into v_job from public.jobs where id = p_job_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.version <> p_expected_job_version then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  if v_job.workshop_snapshot_id is null or v_job.machine_id is null or not exists (
    select 1 from public.workshop_versions wv join public.workshop_snapshot_confirmations c on c.snapshot_id = wv.id
    where wv.id = v_job.workshop_snapshot_id and wv.workspace_id = p_workspace_id
      and exists (select 1 from jsonb_array_elements(wv.snapshot->'machines') m where m->>'id' = v_job.machine_id::text)
  ) then raise exception 'REVIEW_REQUIRED' using errcode = '23514'; end if;
  if v_job.current_draft_id is not null then
    select * into v_draft from public.drafts where id = v_job.current_draft_id and job_id = p_job_id and workspace_id = p_workspace_id for share;
  end if;
  select count(*), count(*) filter (where a.status = 'ready' and a.sha256 is not null and a.kind <> 'issue_photo')
  into v_source_count, v_ready_count
  from public.job_source_assets jsa join public.assets a on a.id = jsa.asset_id and a.job_id = jsa.job_id and a.workspace_id = jsa.workspace_id
  where jsa.workspace_id = p_workspace_id and jsa.job_id = p_job_id;
  if v_source_count = 0 or v_source_count <> v_ready_count then raise exception 'REVIEW_REQUIRED' using errcode = '23514'; end if;
  v_fingerprint := private.current_job_input_fingerprint(p_workspace_id,p_job_id);
  if v_fingerprint is null then raise exception 'REVIEW_REQUIRED' using errcode = '23514'; end if;
  v_claim := public.claim_idempotency_internal('member',p_actor_id,'generate_job:' || p_job_id::text,
    p_idempotency_key,p_payload_hash,90);
  if v_claim->>'state' = 'completed' then return v_claim->'response'; end if;
  if v_claim->>'state' = 'failed' then
    select * into v_generation from public.generations where id = (v_claim->>'resourceId')::uuid and workspace_id = p_workspace_id;
    return jsonb_build_object('state','failed','generation',jsonb_build_object(
      'id',v_generation.id,'jobId',v_generation.job_id,'inputFingerprint',v_generation.input_fingerprint,
      'state',v_generation.state,'startedAt',v_generation.started_at,'expiresAt',v_generation.expires_at,
      'draftVersion',v_generation.draft_version,'errorCode',v_generation.error_code), 'errorCode',v_generation.error_code);
  end if;
  if v_claim->>'state' = 'running' then return jsonb_build_object('state','running','retryAfterSeconds',(v_claim->>'retryAfterSeconds')::integer); end if;
  if v_claim->>'state' <> 'claimed' then raise exception 'IDEMPOTENCY_RUNNING' using errcode = '40001'; end if;
  select * into v_generation from public.generations where idempotency_record_id = (v_claim->>'recordId')::uuid for update;
  if found then
    update public.generations set state = 'running', started_at = clock_timestamp(),
      expires_at = clock_timestamp() + interval '4 minutes', base_job_version = v_job.version,
      base_draft_id = v_job.current_draft_id, base_draft_version = case when v_job.current_draft_id is null then null else v_draft.version end,
      claim_token = (v_claim->>'claimToken')::uuid, input_fingerprint = v_fingerprint,
      error_code = null, draft_version = null
    where id = v_generation.id returning * into v_generation;
  else
    insert into public.generations(workspace_id,job_id,input_fingerprint,state,started_at,expires_at,
      base_job_version,base_draft_id,base_draft_version,claim_token,idempotency_record_id,requested_by)
    values (p_workspace_id,p_job_id,v_fingerprint,'running',clock_timestamp(),clock_timestamp()+interval '4 minutes',
      v_job.version,v_job.current_draft_id,case when v_job.current_draft_id is null then null else v_draft.version end,
      (v_claim->>'claimToken')::uuid,(v_claim->>'recordId')::uuid,p_actor_id) returning * into v_generation;
  end if;
  v_result := jsonb_build_object('state','started','generation',jsonb_build_object(
    'id',v_generation.id,'jobId',v_generation.job_id,'inputFingerprint',v_generation.input_fingerprint,
    'state',v_generation.state,'startedAt',v_generation.started_at,'expiresAt',v_generation.expires_at,
    'draftVersion',v_generation.draft_version,'errorCode',v_generation.error_code),
    'claimToken',v_generation.claim_token,'baseDraftVersion',v_generation.base_draft_version,'jobVersion',v_job.version);
  return v_result;
end;
$function$;

create or replace function public.complete_generation_internal(
  p_workspace_id uuid, p_actor_id uuid, p_generation_id uuid, p_claim_token uuid,
  p_content jsonb, p_model_identifier text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_generation public.generations%rowtype;
  v_job public.jobs%rowtype;
  v_draft public.drafts%rowtype;
  v_content jsonb;
  v_fingerprint text;
  v_count integer;
  v_ready integer;
  v_array text[];
  v_expected text[];
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  perform private.require_member_role(p_workspace_id,p_actor_id,array['designer']::text[]);
  if length(btrim(p_model_identifier)) not between 1 and 200 or jsonb_typeof(p_content) <> 'object' then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  select * into v_generation from public.generations where id = p_generation_id and workspace_id = p_workspace_id
    and requested_by = p_actor_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_generation.state <> 'running' or v_generation.claim_token is distinct from p_claim_token then
    return jsonb_build_object('applied',false,'reason','stale');
  end if;
  if v_generation.expires_at <= v_now then
    update public.generations set state='expired', claim_token=gen_random_uuid() where id=v_generation.id;
    return jsonb_build_object('applied',false,'reason','expired');
  end if;
  select * into v_job from public.jobs where id=v_generation.job_id and workspace_id=p_workspace_id for update;
  if not found then return jsonb_build_object('applied',false,'reason','stale'); end if;
  if v_job.version <> v_generation.base_job_version or v_job.current_draft_id is distinct from v_generation.base_draft_id then
    update public.generations set state='expired', claim_token=gen_random_uuid() where id=v_generation.id;
    return jsonb_build_object('applied',false,'reason','stale');
  end if;
  if v_generation.base_draft_id is not null then
    select * into v_draft from public.drafts where id=v_generation.base_draft_id for update;
    if not found or v_draft.version <> v_generation.base_draft_version then
      update public.generations set state='expired', claim_token=gen_random_uuid() where id=v_generation.id;
      return jsonb_build_object('applied',false,'reason','stale');
    end if;
  end if;
  v_fingerprint := private.current_job_input_fingerprint(p_workspace_id,v_job.id);
  if v_fingerprint is distinct from v_generation.input_fingerprint then
    update public.generations set state='expired', claim_token=gen_random_uuid() where id=v_generation.id;
    return jsonb_build_object('applied',false,'reason','stale');
  end if;
  select array_agg(value order by value collate "C") into v_array from jsonb_array_elements_text(coalesce(p_content->'sourceAssetIds','[]'::jsonb)) value;
  select array_agg(jsa.asset_id::text order by jsa.asset_id::text collate "C"), count(*),
    count(*) filter (where a.status='ready' and a.sha256 is not null and a.kind <> 'issue_photo')
  into v_expected,v_count,v_ready from public.job_source_assets jsa
  join public.assets a on a.id=jsa.asset_id and a.job_id=jsa.job_id and a.workspace_id=jsa.workspace_id
  where jsa.workspace_id=p_workspace_id and jsa.job_id=v_job.id;
  if v_array is distinct from v_expected or v_count = 0 or v_ready <> v_count
    or p_content->>'workshopSnapshotId' is distinct from v_job.workshop_snapshot_id::text
    or p_content->>'machineId' is distinct from v_job.machine_id::text then
    raise exception 'REVIEW_REQUIRED' using errcode = '23514';
  end if;
  v_content := p_content;
  if jsonb_typeof(v_content->'panelModel')='object' then v_content := jsonb_set(v_content,'{panelModel,reviewed}','false'::jsonb,true); end if;
  v_content := jsonb_set(v_content,'{findings}',coalesce((
    select jsonb_agg(finding || jsonb_build_object('disposition','open','resolutionRecordId',null))
    from jsonb_array_elements(coalesce(v_content->'findings','[]'::jsonb)) finding
  ),'[]'::jsonb),true);
  v_content := jsonb_set(v_content,'{machineProposals}',coalesce((
    select jsonb_agg(proposal || jsonb_build_object('status','proposed','decidedBy',null))
    from jsonb_array_elements(coalesce(v_content->'machineProposals','[]'::jsonb)) proposal
  ),'[]'::jsonb),true);
  if v_generation.base_draft_id is null then
    insert into public.drafts(workspace_id,job_id,version,content,generation_id,input_fingerprint,created_by)
    values(p_workspace_id,v_job.id,1,v_content,v_generation.id,v_fingerprint,p_actor_id) returning * into v_draft;
    update public.jobs set current_draft_id=v_draft.id where id=v_job.id and workspace_id=p_workspace_id;
  else
    update public.drafts set content=v_content,version=version+1,generation_id=v_generation.id,
      input_fingerprint=v_fingerprint,updated_at=v_now
    where id=v_generation.base_draft_id and version=v_generation.base_draft_version returning * into v_draft;
  end if;
  update public.generations set state='succeeded',draft_version=v_draft.version,error_code=null,
    model_identifier=btrim(p_model_identifier) where id=v_generation.id returning * into v_generation;
  v_result := jsonb_build_object('state','completed',
    'generation',jsonb_build_object('id',v_generation.id,'jobId',v_generation.job_id,
      'inputFingerprint',v_generation.input_fingerprint,'state',v_generation.state,
      'startedAt',v_generation.started_at,'expiresAt',v_generation.expires_at,
      'draftVersion',v_generation.draft_version,'errorCode',v_generation.error_code),
    'draft',private.draft_dto(v_draft.id,p_workspace_id));
  perform private.complete_idempotency(v_generation.idempotency_record_id,p_claim_token,v_result,v_generation.id);
  return jsonb_build_object('applied',true,'draft',private.draft_dto(v_draft.id,p_workspace_id));
end;
$function$;

create or replace function public.fail_generation_internal(
  p_workspace_id uuid, p_actor_id uuid, p_generation_id uuid, p_claim_token uuid, p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_generation public.generations%rowtype;
  v_error_code text := upper(left(regexp_replace(coalesce(p_error_code,''),'[^A-Za-z0-9_]+','','g'),80));
begin
  perform private.require_member_role(p_workspace_id,p_actor_id,array['designer']::text[]);
  if v_error_code = '' then v_error_code := 'GENERATION_FAILED'; end if;
  select * into v_generation from public.generations where id=p_generation_id and workspace_id=p_workspace_id
    and requested_by=p_actor_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if v_generation.state = 'running' and v_generation.claim_token = p_claim_token then
    update public.generations set state='failed',error_code=v_error_code,claim_token=gen_random_uuid()
    where id=v_generation.id returning * into v_generation;
    update public.idempotency_records set state='failed',claim_token=null,lease_expires_at=null,
      response=null,resource_id=v_generation.id,updated_at=clock_timestamp()
    where id=v_generation.idempotency_record_id and state='running' and claim_token=p_claim_token;
  elsif v_generation.state not in ('failed','expired','succeeded') then
    raise exception 'VERSION_CONFLICT' using errcode='40001';
  end if;
  return jsonb_build_object('id',v_generation.id,'jobId',v_generation.job_id,
    'inputFingerprint',v_generation.input_fingerprint,'state',v_generation.state,
    'startedAt',v_generation.started_at,'expiresAt',v_generation.expires_at,
    'draftVersion',v_generation.draft_version,'errorCode',v_generation.error_code);
end;
$function$;
