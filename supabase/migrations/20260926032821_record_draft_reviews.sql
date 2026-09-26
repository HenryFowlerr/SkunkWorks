-- Record the two current-version attestations atomically. The design reviewer
-- confirms the panel mapping and the explicit guide decisions. A process
-- reviewer must have the fabricator role and a confirmed facility snapshot.
create or replace function public.record_draft_review_internal(
  p_workspace_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_expected_version integer,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.jobs%rowtype;
  v_draft public.drafts%rowtype;
  v_existing public.draft_reviews%rowtype;
  v_role text;
begin
  if p_kind not in ('design', 'process') or p_expected_version < 1 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  select wm.role into v_role
  from public.workspace_members as wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_actor_id
    and wm.status = 'active';

  if v_role is null or
     (p_kind = 'design' and v_role not in ('admin', 'designer')) or
     (p_kind = 'process' and v_role not in ('admin', 'fabricator')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id and workspace_id = p_workspace_id
  for update;
  if not found or v_job.current_draft_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_draft
  from public.drafts
  where id = v_job.current_draft_id
    and job_id = p_job_id
    and workspace_id = p_workspace_id
  for update;
  if not found or v_draft.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  if p_kind = 'design' then
    if jsonb_typeof(v_draft.content->'panelModel') <> 'object'
       or not private.release_guide_decisions_complete(v_draft.content) then
      raise exception 'REVIEW_REQUIRED' using errcode = '23514';
    end if;
  else
    if v_job.workshop_snapshot_id is null or v_job.machine_id is null or not exists (
      select 1
      from public.workshop_versions as wv
      join public.workshop_snapshot_confirmations as wc
        on wc.snapshot_id = wv.id
       and wc.workspace_id = wv.workspace_id
      where wv.id = v_job.workshop_snapshot_id
        and wv.workspace_id = p_workspace_id
        and exists (
          select 1 from jsonb_array_elements(coalesce(wv.snapshot->'machines', '[]'::jsonb)) as machine
          where machine->>'id' = v_job.machine_id::text
        )
    ) then
      raise exception 'REVIEW_REQUIRED' using errcode = '23514';
    end if;
  end if;

  select * into v_existing
  from public.draft_reviews
  where draft_id = v_draft.id
    and draft_version = v_draft.version
    and kind = p_kind;
  if found then
    if v_existing.actor_id = p_actor_id then
      return jsonb_build_object('draftId', v_draft.id, 'version', v_draft.version);
    end if;
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  if exists (
    select 1 from public.draft_reviews as dr
    where dr.draft_id = v_draft.id
      and dr.draft_version = v_draft.version
      and dr.actor_id = p_actor_id
      and dr.kind <> p_kind
  ) then
    raise exception 'REVIEW_REQUIRED' using errcode = '23514';
  end if;

  if p_kind = 'design' then
    update public.drafts
    set content = jsonb_set(content, '{panelModel,reviewed}', 'true'::jsonb, true),
        updated_at = clock_timestamp()
    where id = v_draft.id;
  end if;

  insert into public.draft_reviews (
    workspace_id, job_id, draft_id, kind, actor_id, draft_version
  ) values (
    p_workspace_id, p_job_id, v_draft.id, p_kind, p_actor_id, v_draft.version
  );

  return jsonb_build_object('draftId', v_draft.id, 'version', v_draft.version);
end;
$function$;

revoke all on function public.record_draft_review_internal(uuid, uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_draft_review_internal(uuid, uuid, uuid, integer, text)
  to service_role;
