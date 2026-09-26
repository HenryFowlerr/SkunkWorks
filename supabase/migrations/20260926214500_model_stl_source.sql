-- A viewable STL may travel with a part when no GLB export is available.
-- It remains a visual reference only; source-grounded AI receives readable
-- drawing PDFs and confirmed supplier evidence, never mesh geometry.
alter table public.assets drop constraint assets_kind_check;
alter table public.assets add constraint assets_kind_check
  check (kind in ('drawing_pdf', 'model_glb', 'model_stl', 'bend_manifest', 'native_part', 'native_drawing', 'issue_photo'));

create or replace function public.prepare_source_asset_internal(
  p_workspace_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_asset_id uuid,
  p_kind text,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint,
  p_idempotency_record_id uuid,
  p_idempotency_claim_token uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_limit bigint;
begin
  if p_kind = 'drawing_pdf' then
    v_limit := 25 * 1024 * 1024;
    if lower(p_mime_type) <> 'application/pdf' then
      raise exception 'VALIDATION_FAILED' using errcode = '22023';
    end if;
  elsif p_kind = 'model_glb' then
    v_limit := 50 * 1024 * 1024;
    if lower(p_mime_type) not in ('model/gltf-binary', 'application/octet-stream') then
      raise exception 'VALIDATION_FAILED' using errcode = '22023';
    end if;
  elsif p_kind = 'model_stl' then
    v_limit := 50 * 1024 * 1024;
    if lower(p_mime_type) not in ('model/stl', 'application/sla', 'application/octet-stream')
      or lower(p_filename) not like '%.stl' then
      raise exception 'VALIDATION_FAILED' using errcode = '22023';
    end if;
  elsif p_kind = 'bend_manifest' then
    v_limit := 2 * 1024 * 1024;
    if lower(p_mime_type) <> 'application/json' then
      raise exception 'VALIDATION_FAILED' using errcode = '22023';
    end if;
  elsif p_kind in ('native_part', 'native_drawing') then
    v_limit := 50 * 1024 * 1024;
    if lower(p_mime_type) <> 'application/octet-stream'
      or (p_kind = 'native_part' and lower(p_filename) not like '%.sldprt')
      or (p_kind = 'native_drawing' and lower(p_filename) not like '%.slddrw') then
      raise exception 'VALIDATION_FAILED' using errcode = '22023';
    end if;
  else
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  if p_byte_size <= 0 or p_byte_size > v_limit
    or p_filename is null or length(btrim(p_filename)) = 0
    or p_mime_type is null or length(btrim(p_mime_type)) = 0
  then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.workspace_members as wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_actor_id
      and wm.status = 'active'
      and wm.role in ('admin', 'designer')
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.jobs as j
    where j.workspace_id = p_workspace_id and j.id = p_job_id
  ) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.idempotency_records as i
    where i.id = p_idempotency_record_id
      and i.actor_kind = 'member'
      and i.actor_id = p_actor_id
      and i.operation = 'asset.prepare'
      and i.state = 'running'
      and i.claim_token = p_idempotency_claim_token
    for update
  ) then
    raise exception 'IDEMPOTENCY_CLAIM_LOST' using errcode = '40001';
  end if;

  insert into public.assets (
    id, workspace_id, job_id, kind, filename, mime_type, byte_size,
    sha256, version, status, release_id, storage_key,
    uploaded_by_user_id, uploaded_by_visitor_session_id
  ) values (
    p_asset_id, p_workspace_id, p_job_id, p_kind, p_filename, lower(p_mime_type), p_byte_size,
    null, 1, 'pending', null,
    'workspaces/' || p_workspace_id::text || '/jobs/' || p_job_id::text || '/assets/' || p_asset_id::text || '/blob',
    p_actor_id, null
  );

  perform private.complete_idempotency(
    p_idempotency_record_id,
    p_idempotency_claim_token,
    jsonb_build_object('assetId', p_asset_id),
    p_asset_id
  );
  return p_asset_id;
end;
$function$;

revoke all on function public.prepare_source_asset_internal(uuid, uuid, uuid, uuid, text, text, text, bigint, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_source_asset_internal(uuid, uuid, uuid, uuid, text, text, text, bigint, uuid, uuid)
  to service_role;
