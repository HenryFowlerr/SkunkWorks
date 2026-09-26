-- Draft clarifications and decisions are authored by verified members through
-- service-role RPCs. All mutable decisions lock the job/current draft, compare
-- versions, and advance the draft version so prior reviews cannot be reused.

create or replace function public.record_clarification_internal(
  p_workspace_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_text text,
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
  v_note_id uuid;
  v_result jsonb;
begin
  if p_workspace_id is null or p_job_id is null or p_actor_id is null
     or p_idempotency_record_id is null or p_idempotency_claim_token is null
     or length(btrim(coalesce(p_text, ''))) not between 1 and 4000 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  perform 1 from public.workspace_members as wm
  where wm.workspace_id = p_workspace_id and wm.user_id = p_actor_id
    and wm.status = 'active' and wm.role in ('admin', 'designer')
  for update;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select * into v_job from public.jobs
  where id = p_job_id and workspace_id = p_workspace_id for update;
  if not found or v_job.current_draft_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_draft from public.drafts
  where id = v_job.current_draft_id and job_id = p_job_id
    and workspace_id = p_workspace_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  perform 1 from public.idempotency_records as i
  where i.id = p_idempotency_record_id
    and i.actor_kind = 'member' and i.actor_id = p_actor_id
    and i.operation = 'draft.clarification' and i.state = 'running'
    and i.claim_token = p_idempotency_claim_token
  for update;
  if not found then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;

  insert into public.review_notes (workspace_id, job_id, draft_id, author_id, text)
  values (p_workspace_id, p_job_id, v_draft.id, p_actor_id, btrim(p_text))
  returning id into v_note_id;

  v_result := jsonb_build_object('kind', 'human_clarification', 'recordId', v_note_id);
  perform private.complete_idempotency(p_idempotency_record_id, p_idempotency_claim_token, v_result, v_note_id);
  return v_result;
end;
$function$;

create or replace function public.resolve_draft_finding_internal(
  p_workspace_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_finding_id uuid,
  p_record_id uuid,
  p_expected_version integer
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
  if p_workspace_id is null or p_job_id is null or p_actor_id is null
     or p_finding_id is null or p_record_id is null or p_expected_version < 1 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  perform 1 from public.workspace_members as wm
  where wm.workspace_id = p_workspace_id and wm.user_id = p_actor_id
    and wm.status = 'active' and wm.role in ('admin', 'designer')
  for update;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select * into v_job from public.jobs
  where id = p_job_id and workspace_id = p_workspace_id for update;
  if not found or v_job.current_draft_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_draft from public.drafts
  where id = v_job.current_draft_id and job_id = p_job_id
    and workspace_id = p_workspace_id for update;
  if not found or v_draft.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  perform 1 from public.review_notes as note
  where note.id = p_record_id and note.workspace_id = p_workspace_id
    and note.job_id = p_job_id and note.draft_id = v_draft.id
    and note.author_id = p_actor_id;
  if not found then raise exception 'REVIEW_REQUIRED' using errcode = '23514'; end if;

  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_draft.content->'findings', '[]'::jsonb)) as finding
    where finding->>'id' = p_finding_id::text and finding->>'disposition' = 'open'
  ) then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_draft.content->'findings', '[]'::jsonb)) as finding
    where finding->>'resolutionRecordId' = p_record_id::text
  ) then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;

  v_content := jsonb_set(v_draft.content, '{findings}', (
    select jsonb_agg(
      case when finding.value->>'id' = p_finding_id::text
        then finding.value || jsonb_build_object('disposition', 'resolved', 'resolutionRecordId', p_record_id)
        else finding.value end
      order by finding.ordinality
    )
    from jsonb_array_elements(coalesce(v_draft.content->'findings', '[]'::jsonb))
      with ordinality as finding(value, ordinality)
  ), true);
  if jsonb_typeof(v_content->'panelModel') = 'object' then
    v_content := jsonb_set(v_content, '{panelModel,reviewed}', 'false'::jsonb, true);
  end if;

  update public.drafts
  set content = v_content, version = version + 1, updated_at = clock_timestamp()
  where id = v_draft.id and workspace_id = p_workspace_id
    and job_id = p_job_id and version = p_expected_version;
  if not found then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;

  insert into public.audit_events (workspace_id, job_id, actor_kind, actor_user_id, event_type, entity_id, details)
  values (p_workspace_id, p_job_id, 'member', p_actor_id, 'draft.finding_resolved', p_finding_id,
          jsonb_build_object('draftId', v_draft.id, 'draftVersion', p_expected_version + 1, 'recordId', p_record_id));
  return jsonb_build_object('draftId', v_draft.id, 'version', p_expected_version + 1);
end;
$function$;

create or replace function public.decide_machine_proposal_internal(
  p_workspace_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_proposal_id uuid,
  p_expected_version integer,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.jobs%rowtype;
  v_draft public.drafts%rowtype;
  v_proposal jsonb;
  v_content jsonb;
  v_steps jsonb;
  v_machine jsonb;
  v_order jsonb;
  v_step_count integer;
  v_order_count integer;
  v_unique_count integer;
begin
  if p_workspace_id is null or p_job_id is null or p_actor_id is null
    or p_proposal_id is null or p_expected_version < 1
    or p_decision not in ('accept', 'reject') then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  perform 1 from public.workspace_members as wm
  where wm.workspace_id = p_workspace_id and wm.user_id = p_actor_id
    and wm.status = 'active' and wm.role in ('admin', 'fabricator')
  for update;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select * into v_job from public.jobs
  where id = p_job_id and workspace_id = p_workspace_id for update;
  if not found or v_job.current_draft_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_draft from public.drafts
  where id = v_job.current_draft_id and job_id = p_job_id
    and workspace_id = p_workspace_id for update;
  if not found or v_draft.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  select proposal.value into v_proposal
  from jsonb_array_elements(coalesce(v_draft.content->'machineProposals', '[]'::jsonb)) as proposal(value)
  where proposal.value->>'id' = p_proposal_id::text;
  if v_proposal is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_proposal->>'status' <> 'proposed' then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  v_content := v_draft.content;
  if p_decision = 'accept' then
    if v_job.workshop_snapshot_id is null or v_job.machine_id is null
      or v_proposal->>'snapshotId' is distinct from v_job.workshop_snapshot_id::text
      or v_proposal->>'machineId' is distinct from v_job.machine_id::text
      or v_content->>'workshopSnapshotId' is distinct from v_job.workshop_snapshot_id::text
      or v_content->>'machineId' is distinct from v_job.machine_id::text
      or jsonb_array_length(coalesce(v_proposal->'evidence', '[]'::jsonb)) = 0
      or length(btrim(coalesce(v_proposal->>'rationale', ''))) = 0 then
      raise exception 'REVIEW_REQUIRED' using errcode = '23514';
    end if;

    select machine.value into v_machine
    from public.workshop_versions as wv
    join public.workshop_snapshot_confirmations as wc
      on wc.snapshot_id = wv.id and wc.workspace_id = wv.workspace_id
    cross join lateral jsonb_array_elements(coalesce(wv.snapshot->'machines', '[]'::jsonb)) as machine(value)
    where wv.id = v_job.workshop_snapshot_id and wv.workspace_id = p_workspace_id
      and machine.value->>'id' = v_job.machine_id::text;
    if v_machine is null then raise exception 'REVIEW_REQUIRED' using errcode = '23514'; end if;

    v_order := v_proposal->'proposedBendOrder';
    if jsonb_typeof(v_order) <> 'array' or jsonb_typeof(v_content->'steps') <> 'array'
      or jsonb_typeof(v_content->'bends') <> 'array' then
      raise exception 'VALIDATION_FAILED' using errcode = '22023';
    end if;
    select count(*), count(distinct bend.value)
    into v_order_count, v_unique_count
    from jsonb_array_elements_text(v_order) as bend(value);
    v_step_count := jsonb_array_length(v_content->'steps');
    if v_order_count = 0 or v_order_count <> v_unique_count or v_order_count <> v_step_count
      or v_order_count <> jsonb_array_length(v_content->'bends') then
      raise exception 'VALIDATION_FAILED' using errcode = '22023';
    end if;
    select jsonb_agg(step.value order by wanted.ordinality) into v_steps
    from jsonb_array_elements_text(v_order) with ordinality as wanted(bend_id, ordinality)
    join jsonb_array_elements(v_content->'steps') as step(value)
      on step.value->>'bendId' = wanted.bend_id;
    if v_steps is null or jsonb_array_length(v_steps) <> v_order_count
      or exists (
        select 1 from jsonb_array_elements_text(v_order) as wanted(bend_id)
        where not exists (
          select 1 from jsonb_array_elements(v_content->'bends') as bend(value)
          where bend.value->>'bendId' = wanted.bend_id
        )
      ) then
      raise exception 'VALIDATION_FAILED' using errcode = '22023';
    end if;
    v_content := jsonb_set(v_content, '{steps}', v_steps, true);
  end if;

  v_content := jsonb_set(v_content, '{machineProposals}', (
    select jsonb_agg(
      case when proposal.value->>'id' = p_proposal_id::text
        then proposal.value || jsonb_build_object(
          'status', case when p_decision = 'accept' then 'accepted' else 'rejected' end,
          'decidedBy', p_actor_id)
        else proposal.value end
      order by proposal.ordinality
    )
    from jsonb_array_elements(v_content->'machineProposals')
      with ordinality as proposal(value, ordinality)
  ), true);
  if jsonb_typeof(v_content->'panelModel') = 'object' then
    v_content := jsonb_set(v_content, '{panelModel,reviewed}', 'false'::jsonb, true);
  end if;

  update public.drafts
  set content = v_content, version = version + 1, updated_at = clock_timestamp()
  where id = v_draft.id and workspace_id = p_workspace_id
    and job_id = p_job_id and version = p_expected_version;
  if not found then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;

  insert into public.audit_events (workspace_id, job_id, actor_kind, actor_user_id, event_type, entity_id, details)
  values (p_workspace_id, p_job_id, 'member', p_actor_id, 'draft.machine_proposal_decided', p_proposal_id,
          jsonb_build_object('draftId', v_draft.id, 'draftVersion', p_expected_version + 1, 'decision', p_decision));
  return jsonb_build_object('draftId', v_draft.id, 'version', p_expected_version + 1);
end;
$function$;

revoke all on function public.record_clarification_internal(uuid, uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_draft_finding_internal(uuid, uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.decide_machine_proposal_internal(uuid, uuid, uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_clarification_internal(uuid, uuid, uuid, text, uuid, uuid)
  to service_role;
grant execute on function public.resolve_draft_finding_internal(uuid, uuid, uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.decide_machine_proposal_internal(uuid, uuid, uuid, uuid, integer, text)
  to service_role;
