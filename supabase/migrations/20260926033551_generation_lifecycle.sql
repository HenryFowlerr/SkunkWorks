-- Pending Supabase application. Rename this file to the applied migration version.
-- Generation is request-bound: no background promise can leave a running record as a success.
alter table public.generations
  add column expected_job_version integer,
  add column base_draft_id uuid,
  add column base_draft_version integer;

create or replace function public.start_generation_internal(
  p_workspace_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_generation_id uuid,
  p_expected_job_version integer,
  p_input_fingerprint text,
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
  v_generation public.generations%rowtype;
  v_result jsonb;
begin
  if p_input_fingerprint !~ '^[0-9a-f]{64}$' or p_expected_job_version < 1 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workspace_members as wm
    where wm.workspace_id = p_workspace_id and wm.user_id = p_actor_id
      and wm.status = 'active' and wm.role in ('admin', 'designer')
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.idempotency_records as i
    where i.id = p_idempotency_record_id and i.actor_kind = 'member'
      and i.actor_id = p_actor_id and i.operation = 'generation.create'
      and i.state = 'running' and i.claim_token = p_idempotency_claim_token
      and i.lease_expires_at > clock_timestamp()
  ) then
    raise exception 'IDEMPOTENCY_CLAIM_LOST' using errcode = '40001';
  end if;

  select * into v_job from public.jobs
  where id = p_job_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.version <> p_expected_job_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if v_job.workshop_snapshot_id is null or v_job.machine_id is null or
     private.current_job_input_fingerprint(p_workspace_id, p_job_id) is distinct from p_input_fingerprint then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if exists (
    select 1 from public.generations as g
    where g.workspace_id = p_workspace_id and g.job_id = p_job_id
      and g.state = 'running' and g.expires_at > clock_timestamp()
  ) then
    raise exception 'GENERATION_RUNNING' using errcode = '40001';
  end if;
  update public.generations set state = 'expired'
  where workspace_id = p_workspace_id and job_id = p_job_id
    and state = 'running' and expires_at <= clock_timestamp();

  if v_job.current_draft_id is not null then
    select * into v_draft from public.drafts
    where id = v_job.current_draft_id and job_id = p_job_id and workspace_id = p_workspace_id
    for update;
    if not found then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  end if;
  insert into public.generations (
    id, workspace_id, job_id, input_fingerprint, state, expires_at,
    requested_by, expected_job_version, base_draft_id, base_draft_version
  ) values (
    p_generation_id, p_workspace_id, p_job_id, p_input_fingerprint, 'running',
    clock_timestamp() + interval '90 seconds', p_actor_id, p_expected_job_version,
    v_job.current_draft_id, case when v_job.current_draft_id is null then null else v_draft.version end
  ) returning * into v_generation;
  v_result := jsonb_build_object(
    'id', v_generation.id, 'jobId', v_generation.job_id,
    'inputFingerprint', v_generation.input_fingerprint, 'state', v_generation.state,
    'startedAt', v_generation.started_at, 'expiresAt', v_generation.expires_at,
    'draftVersion', null, 'errorCode', null
  );
  perform private.complete_idempotency(
    p_idempotency_record_id, p_idempotency_claim_token, v_result, p_generation_id
  );
  return v_result;
end;
$function$;

create or replace function public.complete_generation_internal(
  p_workspace_id uuid,
  p_generation_id uuid,
  p_actor_id uuid,
  p_draft_id uuid,
  p_content jsonb
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
  v_next_version integer;
begin
  if jsonb_typeof(p_content) <> 'object' then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  select * into v_generation from public.generations
  where id = p_generation_id and workspace_id = p_workspace_id and requested_by = p_actor_id
  for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_generation.state <> 'running' then
    return jsonb_build_object('state', v_generation.state, 'draftVersion', v_generation.draft_version);
  end if;
  select * into v_job from public.jobs
  where id = v_generation.job_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.current_draft_id is not null then
    select * into v_draft from public.drafts
    where id = v_job.current_draft_id and job_id = v_job.id and workspace_id = p_workspace_id
    for update;
  end if;
  if v_generation.expires_at <= clock_timestamp() or
     v_job.version <> v_generation.expected_job_version or
     private.current_job_input_fingerprint(p_workspace_id, v_job.id) is distinct from v_generation.input_fingerprint or
     v_job.current_draft_id is distinct from v_generation.base_draft_id or
     (case when v_job.current_draft_id is null then null else v_draft.version end) is distinct from v_generation.base_draft_version then
    update public.generations set state = 'expired'
    where id = p_generation_id and state = 'running';
    return jsonb_build_object('state', 'expired', 'draftVersion', null);
  end if;

  v_next_version := coalesce(v_generation.base_draft_version, 0) + 1;
  if v_generation.base_draft_id is null then
    insert into public.drafts (
      id, workspace_id, job_id, version, content, generation_id,
      input_fingerprint, created_by
    ) values (
      p_draft_id, p_workspace_id, v_job.id, v_next_version, p_content,
      p_generation_id, v_generation.input_fingerprint, p_actor_id
    );
    update public.jobs set current_draft_id = p_draft_id
    where id = v_job.id and workspace_id = p_workspace_id;
  else
    update public.drafts set
      version = v_next_version, content = p_content, generation_id = p_generation_id,
      input_fingerprint = v_generation.input_fingerprint, updated_at = clock_timestamp()
    where id = v_generation.base_draft_id and workspace_id = p_workspace_id
      and job_id = v_job.id and version = v_generation.base_draft_version;
    if not found then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  end if;
  update public.generations set state = 'succeeded', draft_version = v_next_version
  where id = p_generation_id and state = 'running';
  return jsonb_build_object('state', 'succeeded', 'draftVersion', v_next_version);
end;
$function$;

create or replace function public.fail_generation_internal(
  p_workspace_id uuid,
  p_generation_id uuid,
  p_actor_id uuid,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_error_code not in (
    'MISSING_CREDENTIALS', 'MISSING_MODEL_CONFIGURATION', 'PROVIDER_TIMEOUT',
    'PROVIDER_UNAVAILABLE', 'MODEL_OR_FEATURE_UNAVAILABLE', 'PROVIDER_REFUSAL',
    'MALFORMED_OUTPUT', 'UNSUPPORTED_CLAIM', 'SOURCE_PREPARATION_FAILED'
  ) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  update public.generations set state = 'failed', error_code = p_error_code
  where id = p_generation_id and workspace_id = p_workspace_id
    and requested_by = p_actor_id and state = 'running';
end;
$function$;

revoke all on function public.start_generation_internal(uuid, uuid, uuid, uuid, integer, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_generation_internal(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_generation_internal(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.start_generation_internal(uuid, uuid, uuid, uuid, integer, text, uuid, uuid)
  to service_role;
grant execute on function public.complete_generation_internal(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
grant execute on function public.fail_generation_internal(uuid, uuid, uuid, text)
  to service_role;
