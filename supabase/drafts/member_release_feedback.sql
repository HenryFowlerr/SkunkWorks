-- Member feedback is tied to the immutable release and an existing step.
-- Visitor feedback will need a separate session-bound path after QR exchange lands.
create or replace function private.release_feedback_context_valid(
  p_snapshot jsonb,
  p_step_id uuid,
  p_bend_id text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_step_id is not null then exists (
      select 1 from jsonb_array_elements(coalesce(p_snapshot->'steps', '[]'::jsonb)) as step
      where step->>'id' = p_step_id::text and step->>'bendId' = p_bend_id
    )
    when p_bend_id is not null then exists (
      select 1 from jsonb_array_elements(coalesce(p_snapshot->'bends', '[]'::jsonb)) as bend
      where bend->>'bendId' = p_bend_id
    )
    else true
  end;
$function$;

create or replace function public.record_release_question_internal(
  p_workspace_id uuid,
  p_job_id uuid,
  p_release_id uuid,
  p_step_id uuid,
  p_bend_id text,
  p_actor_id uuid,
  p_question_id uuid,
  p_question text,
  p_answer jsonb,
  p_idempotency_record_id uuid,
  p_idempotency_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_release public.releases%rowtype;
  v_claim public.idempotency_records%rowtype;
begin
  if p_workspace_id is null or p_job_id is null or p_release_id is null or p_actor_id is null
    or p_question_id is null or length(btrim(coalesce(p_question, ''))) not between 3 and 2000
    or jsonb_typeof(p_answer) is distinct from 'object'
    or p_answer->>'id' is distinct from p_question_id::text
    or p_answer #>> '{context,jobId}' is distinct from p_job_id::text
    or p_answer #>> '{context,releaseId}' is distinct from p_release_id::text
    or p_answer #>> '{context,stepId}' is distinct from p_step_id::text
    or p_answer #>> '{context,bendId}' is distinct from p_bend_id
    or p_answer->>'evidenceState' is distinct from 'not_found'
    or p_answer->'evidence' is distinct from '[]'::jsonb
  then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = p_workspace_id and member.user_id = p_actor_id
      and member.status = 'active'
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_release from public.releases
  where id = p_release_id and job_id = p_job_id and workspace_id = p_workspace_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not private.release_feedback_context_valid(v_release.snapshot, p_step_id, p_bend_id) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  select * into v_claim from public.idempotency_records
  where id = p_idempotency_record_id for update;
  if not found or v_claim.actor_kind <> 'member' or v_claim.actor_id <> p_actor_id
    or v_claim.operation <> 'question.ask' or v_claim.state <> 'running'
    or v_claim.claim_token <> p_idempotency_claim_token
    or v_claim.lease_expires_at <= clock_timestamp() then
    raise exception 'IDEMPOTENCY_CLAIM_LOST' using errcode = '40001';
  end if;

  insert into public.questions (
    id, workspace_id, job_id, release_id, step_id, bend_id,
    question, actor_kind, actor_user_id, answer
  ) values (
    p_question_id, p_workspace_id, p_job_id, p_release_id, p_step_id, p_bend_id,
    btrim(p_question), 'member', p_actor_id, p_answer
  );
  perform private.complete_idempotency(
    p_idempotency_record_id, p_idempotency_claim_token, p_answer, p_question_id
  );
  return p_answer;
end;
$function$;

create or replace function public.create_release_flag_internal(
  p_workspace_id uuid,
  p_job_id uuid,
  p_release_id uuid,
  p_step_id uuid,
  p_bend_id text,
  p_actor_id uuid,
  p_flag_id uuid,
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
  v_release public.releases%rowtype;
  v_claim public.idempotency_records%rowtype;
begin
  if p_workspace_id is null or p_job_id is null or p_release_id is null or p_actor_id is null
    or p_flag_id is null or length(btrim(coalesce(p_question, ''))) not between 3 and 2000
    or length(btrim(coalesce(p_display_name, ''))) not between 1 and 120
  then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = p_workspace_id and member.user_id = p_actor_id
      and member.status = 'active'
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_release from public.releases
  where id = p_release_id and job_id = p_job_id and workspace_id = p_workspace_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not private.release_feedback_context_valid(v_release.snapshot, p_step_id, p_bend_id) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  select * into v_claim from public.idempotency_records
  where id = p_idempotency_record_id for update;
  if not found or v_claim.actor_kind <> 'member' or v_claim.actor_id <> p_actor_id
    or v_claim.operation <> 'flag.create' or v_claim.state <> 'running'
    or v_claim.claim_token <> p_idempotency_claim_token
    or v_claim.lease_expires_at <= clock_timestamp() then
    raise exception 'IDEMPOTENCY_CLAIM_LOST' using errcode = '40001';
  end if;

  insert into public.flags (
    id, workspace_id, job_id, release_id, step_id, bend_id,
    question, created_by_kind, created_by_user_id, created_by_display_name
  ) values (
    p_flag_id, p_workspace_id, p_job_id, p_release_id, p_step_id, p_bend_id,
    btrim(p_question), 'member', p_actor_id, btrim(p_display_name)
  );
  perform private.complete_idempotency(
    p_idempotency_record_id, p_idempotency_claim_token,
    jsonb_build_object('flagId', p_flag_id), p_flag_id
  );
  return jsonb_build_object('flagId', p_flag_id);
end;
$function$;

revoke all on function private.release_feedback_context_valid(jsonb, uuid, text)
  from public, anon, authenticated;
revoke all on function public.record_release_question_internal(uuid, uuid, uuid, uuid, text, uuid, uuid, text, jsonb, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_release_question_internal(uuid, uuid, uuid, uuid, text, uuid, uuid, text, jsonb, uuid, uuid)
  to service_role;
revoke all on function public.create_release_flag_internal(uuid, uuid, uuid, uuid, text, uuid, uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_release_flag_internal(uuid, uuid, uuid, uuid, text, uuid, uuid, text, text, uuid, uuid)
  to service_role;
