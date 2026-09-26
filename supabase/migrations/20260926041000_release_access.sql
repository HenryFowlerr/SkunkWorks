-- Release QR links are bearer capabilities. Only the server service role may
-- invoke these functions; every member operation validates the live role here.
create or replace function public.issue_release_access_link_internal(
  p_release_id uuid,
  p_actor_id uuid,
  p_token_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_release public.releases%rowtype;
  v_link public.release_access_links%rowtype;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  select * into v_release from public.releases where id = p_release_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = v_release.workspace_id and user_id = p_actor_id
      and status = 'active' and role in ('admin', 'designer')
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  insert into public.release_access_links
    (workspace_id, job_id, release_id, token_hash, created_by)
  values
    (v_release.workspace_id, v_release.job_id, v_release.id, p_token_hash, p_actor_id)
  on conflict (token_hash) do nothing;

  select * into v_link from public.release_access_links where token_hash = p_token_hash;
  if v_link.release_id <> p_release_id or v_link.created_by <> p_actor_id then
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
  end if;
  if v_link.revoked_at is not null then
    raise exception 'RELEASE_REVOKED' using errcode = '42501';
  end if;
  return jsonb_build_object('linkId', v_link.id);
end;
$function$;

create or replace function public.list_release_access_links_internal(
  p_release_id uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_release public.releases%rowtype;
  v_links jsonb;
begin
  select * into v_release from public.releases where id = p_release_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = v_release.workspace_id and user_id = p_actor_id
      and status = 'active' and role in ('admin', 'designer')
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'linkId', l.id, 'createdAt', l.created_at, 'revokedAt', l.revoked_at
  ) order by l.created_at desc), '[]'::jsonb) into v_links
  from public.release_access_links l where l.release_id = p_release_id;
  return v_links;
end;
$function$;

create or replace function public.revoke_release_access_link_internal(
  p_release_id uuid,
  p_link_id uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_link public.release_access_links%rowtype;
begin
  select * into v_link from public.release_access_links
  where id = p_link_id and release_id = p_release_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = v_link.workspace_id and user_id = p_actor_id
      and status = 'active' and role in ('admin', 'designer')
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.release_access_links
  set revoked_at = clock_timestamp()
  where id = p_link_id and revoked_at is null
  returning * into v_link;
  if not found then
    select * into v_link from public.release_access_links where id = p_link_id;
  end if;
  return jsonb_build_object('linkId', v_link.id, 'revokedAt', v_link.revoked_at);
end;
$function$;

-- A scan exchanges the raw link token for a separate HttpOnly cookie secret.
-- The cookie remains tied to this original link, so link revocation disables
-- every existing session and successor grant immediately.
create or replace function public.exchange_release_access_link_internal(
  p_token_hash text,
  p_session_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_link public.release_access_links%rowtype;
  v_session public.release_visitor_sessions%rowtype;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  select * into v_link from public.release_access_links
  where token_hash = p_token_hash for share;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_link.revoked_at is not null then
    raise exception 'RELEASE_REVOKED' using errcode = '42501';
  end if;
  insert into public.release_visitor_sessions
    (access_link_id, session_token_hash, expires_at)
  values
    (v_link.id, p_session_hash, clock_timestamp() + interval '24 hours')
  returning * into v_session;
  insert into public.release_visitor_session_grants
    (workspace_id, job_id, session_id, origin_release_id,
     origin_access_link_id, release_id, grant_kind)
  values
    (v_link.workspace_id, v_link.job_id, v_session.id, v_link.release_id,
     v_link.id, v_link.release_id, 'original_link');
  return jsonb_build_object(
    'releaseId', v_link.release_id,
    'expiresAt', v_session.expires_at
  );
end;
$function$;

-- Called for every visitor read. No token, session ID, or source storage key is returned.
create or replace function public.read_release_visitor_scope_internal(
  p_release_id uuid,
  p_session_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_session public.release_visitor_sessions%rowtype;
  v_link public.release_access_links%rowtype;
  v_release public.releases%rowtype;
  v_job public.jobs%rowtype;
  v_assets jsonb;
begin
  if p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into v_session from public.release_visitor_sessions
  where session_token_hash = p_session_hash for share;
  if not found then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into v_link from public.release_access_links where id = v_session.access_link_id for share;
  if v_link.revoked_at is not null or v_session.revoked_at is not null or
     v_session.expires_at <= clock_timestamp() then
    raise exception 'RELEASE_REVOKED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.release_visitor_session_grants
    where session_id = v_session.id and release_id = p_release_id
      and origin_access_link_id = v_link.id
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_release from public.releases where id = p_release_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_job from public.jobs where id = v_release.job_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'jobId', a.job_id, 'releaseId', a.release_id,
    'kind', a.kind, 'filename', a.filename, 'mimeType', a.mime_type,
    'byteSize', a.byte_size, 'sha256', a.sha256, 'version', a.version,
    'status', a.status, 'drawingRevision', a.drawing_revision
  ) order by a.id), '[]'::jsonb) into v_assets
  from public.release_assets ra
  join public.assets a on a.id = ra.asset_id
  where ra.release_id = p_release_id and a.status = 'ready';
  return jsonb_build_object(
    'sessionId', v_session.id,
    'displayName', v_session.display_name,
    'job', jsonb_build_object(
      'id', v_job.id, 'workspaceId', v_job.workspace_id,
      'title', v_job.title, 'partNumber', v_job.part_number,
      'partFamily', v_job.part_family, 'version', v_job.version,
      'workshopSnapshotId', v_release.snapshot->>'workshopSnapshotId',
      'machineId', v_release.snapshot->>'machineId',
      'sourceAssetIds', v_release.snapshot->'sourceAssetIds',
      'draftId', null, 'latestReleaseId', null,
      'createdAt', v_job.created_at
    ),
    'release', jsonb_build_object(
      'id', v_release.id, 'jobId', v_release.job_id,
      'revisionNumber', v_release.revision_number,
      'snapshot', v_release.snapshot,
      'sourceDraftVersion', v_release.source_draft_version,
      'reviews', v_release.reviews,
      'publishedAt', v_release.published_at,
      'publishedBy', v_release.published_by,
      'supersedesReleaseId', v_release.supersedes_release_id,
      'allowPredecessorVisitors', v_release.allow_predecessor_visitors
    ),
    'sourceAssets', v_assets
  );
end;
$function$;

-- A visitor can receive a short-lived signed URL only for a ready source asset
-- contained in a release explicitly granted to that live session.
create or replace function public.read_release_visitor_asset_internal(
  p_asset_id uuid,
  p_session_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_session public.release_visitor_sessions%rowtype;
  v_link public.release_access_links%rowtype;
  v_asset public.assets%rowtype;
begin
  if p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into v_session from public.release_visitor_sessions
  where session_token_hash = p_session_hash for share;
  if not found then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into v_link from public.release_access_links
  where id = v_session.access_link_id for share;
  if v_link.revoked_at is not null or v_session.revoked_at is not null or
     v_session.expires_at <= clock_timestamp() then
    raise exception 'RELEASE_REVOKED' using errcode = '42501';
  end if;
  select a.* into v_asset
  from public.assets a
  join public.release_assets ra on ra.asset_id = a.id
  join public.release_visitor_session_grants g
    on g.release_id = ra.release_id and g.session_id = v_session.id
      and g.origin_access_link_id = v_link.id
  where a.id = p_asset_id and a.status = 'ready'
    and a.release_id is null and a.sha256 is not null
  limit 1;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object('objectKey', v_asset.storage_key);
end;
$function$;

revoke all on function public.issue_release_access_link_internal(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.revoke_release_access_link_internal(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.list_release_access_links_internal(uuid,uuid) from public, anon, authenticated;
revoke all on function public.exchange_release_access_link_internal(text,text) from public, anon, authenticated;
revoke all on function public.read_release_visitor_scope_internal(uuid,text) from public, anon, authenticated;
revoke all on function public.read_release_visitor_asset_internal(uuid,text) from public, anon, authenticated;
grant execute on function public.issue_release_access_link_internal(uuid,uuid,text) to service_role;
grant execute on function public.revoke_release_access_link_internal(uuid,uuid,uuid) to service_role;
grant execute on function public.list_release_access_links_internal(uuid,uuid) to service_role;
grant execute on function public.exchange_release_access_link_internal(text,text) to service_role;
grant execute on function public.read_release_visitor_scope_internal(uuid,text) to service_role;
grant execute on function public.read_release_visitor_asset_internal(uuid,text) to service_role;
