-- Member-only floor reports and explicit engineer clarifications. No QR visitor
-- writes or photo uploads are enabled here. Reports remain unapproved until a
-- designer/admin submits a response; AI proposals never call these functions.
create or replace function private.member_flag_json(p_workspace_id uuid, p_flag_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', f.id,
    'context', jsonb_build_object('jobId', f.job_id, 'releaseId', f.release_id,
      'draftId', null, 'draftVersion', null, 'stepId', f.step_id, 'bendId', f.bend_id),
    'question', f.question,
    'photoAssetIds', coalesce((select jsonb_agg(p.asset_id order by p.attached_at, p.asset_id)
      from public.flag_photo_assets p where p.workspace_id = f.workspace_id and p.flag_id = f.id), '[]'::jsonb),
    'createdBy', jsonb_build_object(
      'id', coalesce(f.created_by_user_id, f.created_by_session_id),
      'displayName', f.created_by_display_name,
      'kind', f.created_by_kind,
      'roles', coalesce((select jsonb_build_array(wm.role) from public.workspace_members wm
        where wm.workspace_id = f.workspace_id and wm.user_id = f.created_by_user_id
          and wm.status = 'active'), '[]'::jsonb)),
    'version', f.version, 'status', f.status, 'createdAt', f.created_at,
    'response', (select jsonb_build_object('text', r.text, 'authorId', r.author_id,
        'at', r.created_at, 'kind', r.kind, 'replacementReleaseId', r.replacement_release_id)
      from public.flag_responses r where r.workspace_id = f.workspace_id and r.flag_id = f.id
      order by r.flag_version desc limit 1))
  from public.flags f where f.workspace_id = p_workspace_id and f.id = p_flag_id;
$function$;

create or replace function public.create_member_flag_internal(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_flag_id uuid,
  p_context jsonb,
  p_question text,
  p_display_name text,
  p_idempotency_record_id uuid,
  p_idempotency_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim public.idempotency_records%rowtype;
  v_release public.releases%rowtype;
  v_job_id uuid;
  v_release_id uuid;
  v_step_id uuid;
  v_bend_id text;
  v_result jsonb;
begin
  if p_workspace_id is null or p_actor_id is null or p_flag_id is null
    or length(btrim(coalesce(p_question, ''))) not between 1 and 10000
    or length(btrim(coalesce(p_display_name, ''))) not between 1 and 120
    or jsonb_typeof(p_context) is distinct from 'object'
    or not (p_context ?& array['jobId', 'releaseId', 'draftId', 'draftVersion', 'stepId', 'bendId'])
    or p_context - array['jobId', 'releaseId', 'draftId', 'draftVersion', 'stepId', 'bendId'] <> '{}'::jsonb
    or p_context->'draftId' is distinct from 'null'::jsonb
    or p_context->'draftVersion' is distinct from 'null'::jsonb
    or jsonb_typeof(p_context->'jobId') is distinct from 'string'
    or jsonb_typeof(p_context->'releaseId') is distinct from 'string'
    or jsonb_typeof(p_context->'stepId') not in ('string', 'null')
    or jsonb_typeof(p_context->'bendId') not in ('string', 'null') then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  begin
    v_job_id := (p_context->>'jobId')::uuid;
    v_release_id := (p_context->>'releaseId')::uuid;
    v_step_id := (p_context->>'stepId')::uuid;
  exception when invalid_text_representation then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end;
  v_bend_id := p_context->>'bendId';

  -- Lock membership until commit so a concurrent revocation cannot race the write.
  perform 1 from public.workspace_members wm
  where wm.workspace_id = p_workspace_id and wm.user_id = p_actor_id
    and wm.status = 'active' for share;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select * into v_release from public.releases
  where id = v_release_id and job_id = v_job_id and workspace_id = p_workspace_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  if (v_step_id is not null and not exists (
    select 1 from jsonb_array_elements(v_release.snapshot->'steps') s
    where s->>'id' = v_step_id::text and s->>'bendId' is not distinct from v_bend_id
  )) or (v_bend_id is not null and not exists (
    select 1 from jsonb_array_elements(v_release.snapshot->'bends') b
    where b->>'bendId' = v_bend_id
  )) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  select * into v_claim from public.idempotency_records
  where id = p_idempotency_record_id for update;
  if not found or v_claim.actor_kind is distinct from 'member'
    or v_claim.actor_id is distinct from p_actor_id
    or v_claim.operation is distinct from 'flag.create'
    or v_claim.state is distinct from 'running'
    or p_idempotency_claim_token is null
    or v_claim.claim_token is distinct from p_idempotency_claim_token
    or v_claim.lease_expires_at is null or v_claim.lease_expires_at <= clock_timestamp() then
    raise exception 'IDEMPOTENCY_CLAIM_LOST' using errcode = '40001';
  end if;

  insert into public.flags (id, workspace_id, job_id, release_id, step_id, bend_id,
    question, created_by_kind, created_by_user_id, created_by_display_name)
  values (p_flag_id, p_workspace_id, v_job_id, v_release_id, v_step_id, v_bend_id,
    btrim(p_question), 'member', p_actor_id, btrim(p_display_name));
  v_result := private.member_flag_json(p_workspace_id, p_flag_id);
  perform private.complete_idempotency(
    p_idempotency_record_id, p_idempotency_claim_token, v_result, p_flag_id);
  return v_result;
end;
$function$;

create or replace function public.respond_to_flag_internal(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_flag_id uuid,
  p_expected_version integer,
  p_text text,
  p_kind text,
  p_replacement_release_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_flag public.flags%rowtype;
begin
  if p_workspace_id is null or p_actor_id is null or p_flag_id is null
    or p_expected_version is null or p_expected_version < 1
    or length(btrim(coalesce(p_text, ''))) not between 1 and 10000
    or p_kind is null or p_kind not in ('explanation', 'replacement_release')
    or (p_kind = 'replacement_release') <> (p_replacement_release_id is not null) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  perform 1 from public.workspace_members wm
  where wm.workspace_id = p_workspace_id and wm.user_id = p_actor_id
    and wm.status = 'active' and wm.role in ('designer', 'admin') for share;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select * into v_flag from public.flags
  where id = p_flag_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- A retry of an already committed version cannot append a duplicate answer.
  if v_flag.version <> p_expected_version or v_flag.status = 'resolved' then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if p_kind = 'replacement_release' and not exists (
    select 1 from public.releases r
    where r.id = p_replacement_release_id and r.workspace_id = p_workspace_id
      and r.job_id = v_flag.job_id and r.supersedes_release_id = v_flag.release_id
  ) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  insert into public.flag_responses (workspace_id, job_id, release_id, flag_id,
    flag_version, text, author_id, kind, replacement_release_id)
  values (p_workspace_id, v_flag.job_id, v_flag.release_id, p_flag_id,
    v_flag.version + 1, btrim(p_text), p_actor_id, p_kind, p_replacement_release_id);
  update public.flags set version = version + 1, status = 'responded'
  where id = p_flag_id and workspace_id = p_workspace_id;
  return private.member_flag_json(p_workspace_id, p_flag_id);
end;
$function$;

revoke all on function private.member_flag_json(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_member_flag_internal(uuid, uuid, uuid, jsonb, text, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.respond_to_flag_internal(uuid, uuid, uuid, integer, text, text, uuid)
  from public, anon, authenticated;
grant execute on function private.member_flag_json(uuid, uuid) to service_role;
grant execute on function public.create_member_flag_internal(uuid, uuid, uuid, jsonb, text, text, uuid, uuid)
  to service_role;
grant execute on function public.respond_to_flag_internal(uuid, uuid, uuid, integer, text, text, uuid)
  to service_role;
