-- Job intake stays atomic with its idempotency claim and checks that the
-- selected facility snapshot was confirmed before use.
create or replace function public.create_job_internal(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_job_id uuid,
  p_title text,
  p_part_number text,
  p_part_family text,
  p_workshop_snapshot_id uuid,
  p_machine_id uuid,
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
  v_job public.jobs%rowtype;
  v_result jsonb;
begin
  if p_workspace_id is null or p_actor_id is null or p_job_id is null
    or length(btrim(coalesce(p_title, ''))) not between 1 and 160
    or length(btrim(coalesce(p_part_number, ''))) not between 1 and 120
    or length(btrim(coalesce(p_part_family, ''))) not between 1 and 120
    or (p_workshop_snapshot_id is null) <> (p_machine_id is null) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.workspace_members as wm
    where wm.workspace_id = p_workspace_id and wm.user_id = p_actor_id
      and wm.status = 'active' and wm.role in ('admin', 'designer')
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_claim from public.idempotency_records
  where id = p_idempotency_record_id for update;
  if not found or v_claim.actor_kind <> 'member' or v_claim.actor_id <> p_actor_id
    or v_claim.operation <> 'job.create' or v_claim.state <> 'running'
    or v_claim.claim_token <> p_idempotency_claim_token
    or v_claim.lease_expires_at <= clock_timestamp() then
    raise exception 'IDEMPOTENCY_CLAIM_LOST' using errcode = '40001';
  end if;

  if p_workshop_snapshot_id is not null and not exists (
    select 1 from public.workshop_versions as wv
    join public.workshop_snapshot_confirmations as c on c.snapshot_id = wv.id
    where wv.workspace_id = p_workspace_id and wv.id = p_workshop_snapshot_id
      and exists (
        select 1 from jsonb_array_elements(coalesce(wv.snapshot->'machines', '[]'::jsonb)) as machine
        where machine->>'id' = p_machine_id::text
      )
  ) then
    raise exception 'REVIEW_REQUIRED' using errcode = '22023';
  end if;

  insert into public.jobs (
    id, workspace_id, title, part_number, part_family,
    workshop_snapshot_id, machine_id, created_by
  ) values (
    p_job_id, p_workspace_id, btrim(p_title), btrim(p_part_number), btrim(p_part_family),
    p_workshop_snapshot_id, p_machine_id, p_actor_id
  ) returning * into v_job;

  v_result := jsonb_build_object(
    'id', v_job.id,
    'workspaceId', v_job.workspace_id,
    'title', v_job.title,
    'partNumber', v_job.part_number,
    'partFamily', v_job.part_family,
    'version', v_job.version,
    'workshopSnapshotId', v_job.workshop_snapshot_id,
    'machineId', v_job.machine_id,
    'sourceAssetIds', '[]'::jsonb,
    'draftId', v_job.current_draft_id,
    'latestReleaseId', v_job.latest_release_id,
    'createdAt', v_job.created_at
  );
  perform private.complete_idempotency(
    p_idempotency_record_id, p_idempotency_claim_token, v_result, p_job_id
  );
  return v_result;
end;
$function$;

revoke all on function public.create_job_internal(uuid, uuid, uuid, text, text, text, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_job_internal(uuid, uuid, uuid, text, text, text, uuid, uuid, uuid, uuid)
  to service_role;
