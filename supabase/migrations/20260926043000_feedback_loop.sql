-- Server-only feedback mutations. Every call rechecks the member role or the
-- exact, live QR session grant inside the same transaction as its write.

create or replace function private.feedback_actor_internal(
  p_release_id uuid, p_actor_id uuid, p_session_hash text, p_response boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_release public.releases%rowtype;
  v_member public.workspace_members%rowtype;
  v_session public.release_visitor_sessions%rowtype;
  v_link public.release_access_links%rowtype;
  v_name text;
begin
  if (p_actor_id is null) = (p_session_hash is null) then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into v_release from public.releases where id = p_release_id for key share;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  if p_actor_id is not null then
    select * into v_member from public.workspace_members
    where workspace_id = v_release.workspace_id and user_id = p_actor_id
      and status = 'active' for key share;
    if not found or (p_response and v_member.role not in ('admin', 'designer')) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    select display_name into v_name from public.user_profiles where user_id = p_actor_id;
    return jsonb_build_object(
      'kind', 'member', 'actorId', p_actor_id,
      'workspaceId', v_release.workspace_id, 'jobId', v_release.job_id,
      'displayName', coalesce(nullif(btrim(v_name), ''), 'Member')
    );
  end if;

  if p_response or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_session from public.release_visitor_sessions
  where session_token_hash = p_session_hash for key share;
  if not found then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into v_link from public.release_access_links
  where id = v_session.access_link_id for key share;
  if not found or v_session.revoked_at is not null or v_link.revoked_at is not null
    or v_session.expires_at <= clock_timestamp() then
    raise exception 'RELEASE_REVOKED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.release_visitor_session_grants as g
    where g.session_id = v_session.id and g.release_id = p_release_id
      and g.origin_access_link_id = v_link.id
      and g.workspace_id = v_release.workspace_id and g.job_id = v_release.job_id
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'kind', 'release_visitor', 'actorId', v_session.id,
    'workspaceId', v_release.workspace_id, 'jobId', v_release.job_id,
    'displayName', v_session.display_name
  );
end;
$function$;

create or replace function private.feedback_check_context_internal(
  p_release_id uuid, p_step_id uuid, p_bend_id text
) returns void language plpgsql security definer set search_path = '' as $function$
declare v_snapshot jsonb;
begin
  select snapshot into v_snapshot from public.releases where id = p_release_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_step_id is not null and not exists (
    select 1 from jsonb_array_elements(coalesce(v_snapshot->'steps', '[]'::jsonb)) as s
    where s->>'id' = p_step_id::text and s->>'bendId' = p_bend_id
  ) then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  if p_bend_id is not null and not exists (
    select 1 from jsonb_array_elements(coalesce(v_snapshot->'bends', '[]'::jsonb)) as b
    where b->>'bendId' = p_bend_id
  ) then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
end;
$function$;

create or replace function private.feedback_flag_payload_internal(p_flag_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_flag public.flags%rowtype;
  v_response public.flag_responses%rowtype;
  v_photos jsonb;
  v_role text;
begin
  select * into v_flag from public.flags where id = p_flag_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(asset_id order by asset_id), '[]'::jsonb)
    into v_photos from public.flag_photo_assets where flag_id = p_flag_id;
  select * into v_response from public.flag_responses
    where flag_id = p_flag_id order by flag_version desc limit 1;
  if v_flag.created_by_user_id is not null then
    select role into v_role from public.workspace_members
    where workspace_id = v_flag.workspace_id and user_id = v_flag.created_by_user_id
      and status = 'active';
  end if;
  return jsonb_build_object(
    'id', v_flag.id,
    'context', jsonb_build_object(
      'jobId', v_flag.job_id, 'releaseId', v_flag.release_id,
      'draftId', null, 'draftVersion', null,
      'stepId', v_flag.step_id, 'bendId', v_flag.bend_id
    ),
    'question', v_flag.question, 'photoAssetIds', v_photos,
    'createdBy', jsonb_build_object(
      'id', coalesce(v_flag.created_by_user_id, v_flag.created_by_session_id),
      'displayName', v_flag.created_by_display_name,
      'kind', v_flag.created_by_kind,
      'roles', case when v_role is null then '[]'::jsonb else jsonb_build_array(v_role) end
    ),
    'version', v_flag.version, 'status', v_flag.status,
    'createdAt', v_flag.created_at,
    'response', case when v_response.id is null then null else jsonb_build_object(
      'text', v_response.text, 'authorId', v_response.author_id,
      'at', v_response.created_at, 'kind', v_response.kind,
      'replacementReleaseId', v_response.replacement_release_id
    ) end
  );
end;
$function$;

create or replace function public.list_visitor_release_flags_internal(
  p_release_id uuid, p_session_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_flags jsonb;
begin
  perform private.feedback_actor_internal(p_release_id, null, p_session_hash, false);
  select coalesce(jsonb_agg(private.feedback_flag_payload_internal(f.id)
    order by f.created_at desc), '[]'::jsonb) into v_flags
  from public.flags as f where f.release_id = p_release_id;
  return v_flags;
end;
$function$;

create or replace function public.create_release_flag_internal(
  p_flag_id uuid, p_release_id uuid, p_actor_id uuid, p_session_hash text,
  p_step_id uuid, p_bend_id text, p_question text, p_photo_asset_ids uuid[],
  p_idempotency_key text, p_payload_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_actor jsonb;
  v_record public.idempotency_records%rowtype;
  v_new boolean;
  v_photo uuid;
  v_payload jsonb;
begin
  if p_flag_id is null or p_release_id is null or length(btrim(coalesce(p_question, ''))) not between 3 and 2000
    or length(p_idempotency_key) not between 16 and 128
    or p_payload_hash !~ '^[0-9a-f]{64}$'
    or cardinality(p_photo_asset_ids) > 3
    or cardinality(p_photo_asset_ids) is distinct from (
      select count(distinct photo.id)::integer
      from unnest(coalesce(p_photo_asset_ids, '{}'::uuid[])) as photo(id)
    ) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  v_actor := private.feedback_actor_internal(p_release_id, p_actor_id, p_session_hash, false);
  if p_answer->'context'->>'jobId' is distinct from v_actor->>'jobId'
    or p_answer->'context'->'draftId' is distinct from 'null'::jsonb
    or p_answer->'context'->'draftVersion' is distinct from 'null'::jsonb then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  perform private.feedback_check_context_internal(p_release_id, p_step_id, p_bend_id);

  insert into public.idempotency_records (
    actor_kind, actor_id, operation, idempotency_key, payload_hash,
    state, claim_token, lease_expires_at
  ) values (
    v_actor->>'kind', (v_actor->>'actorId')::uuid, 'flag.create',
    p_idempotency_key, p_payload_hash, 'running', gen_random_uuid(),
    clock_timestamp() + interval '90 seconds'
  ) on conflict (actor_kind, actor_id, operation, idempotency_key) do nothing;
  v_new := found;
  select * into v_record from public.idempotency_records
  where actor_kind = v_actor->>'kind' and actor_id = (v_actor->>'actorId')::uuid
    and operation = 'flag.create' and idempotency_key = p_idempotency_key for update;
  if v_record.payload_hash is distinct from p_payload_hash then
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
  end if;
  if v_record.state = 'completed' then return v_record.response; end if;
  if not v_new then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;

  insert into public.flags (
    id, workspace_id, job_id, release_id, step_id, bend_id, question,
    created_by_kind, created_by_user_id, created_by_session_id, created_by_display_name
  ) values (
    p_flag_id, (v_actor->>'workspaceId')::uuid, (v_actor->>'jobId')::uuid,
    p_release_id, p_step_id, p_bend_id, btrim(p_question),
    v_actor->>'kind', case when p_actor_id is not null then p_actor_id else null end,
    case when p_actor_id is null then (v_actor->>'actorId')::uuid else null end,
    v_actor->>'displayName'
  );
  if p_photo_asset_ids is not null then
    foreach v_photo in array p_photo_asset_ids loop
      if not exists (
        select 1 from public.assets as a
        where a.id = v_photo and a.workspace_id = (v_actor->>'workspaceId')::uuid
          and a.job_id = (v_actor->>'jobId')::uuid and a.release_id = p_release_id
          and a.kind = 'issue_photo' and a.status = 'ready' and a.sha256 is not null
          and ((p_actor_id is not null and a.uploaded_by_user_id = p_actor_id)
            or (p_actor_id is null and a.uploaded_by_visitor_session_id = (v_actor->>'actorId')::uuid))
      ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
      insert into public.flag_photo_assets (
        workspace_id, job_id, release_id, flag_id, asset_id
      ) values (
        (v_actor->>'workspaceId')::uuid, (v_actor->>'jobId')::uuid,
        p_release_id, p_flag_id, v_photo
      );
    end loop;
  end if;
  v_payload := private.feedback_flag_payload_internal(p_flag_id);
  update public.idempotency_records set state = 'completed', response = v_payload,
    resource_id = p_flag_id, claim_token = null, lease_expires_at = null,
    updated_at = clock_timestamp()
  where id = v_record.id;
  return v_payload;
end;
$function$;

create or replace function public.respond_release_flag_internal(
  p_flag_id uuid, p_actor_id uuid, p_expected_version integer,
  p_text text, p_kind text, p_replacement_release_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_flag public.flags%rowtype;
  v_replacement public.releases%rowtype;
begin
  if p_actor_id is null or p_flag_id is null or p_expected_version < 1
    or length(btrim(coalesce(p_text, ''))) not between 1 and 2000
    or p_kind not in ('explanation', 'replacement_release')
    or (p_kind = 'replacement_release') <> (p_replacement_release_id is not null) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  select * into v_flag from public.flags where id = p_flag_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.feedback_actor_internal(v_flag.release_id, p_actor_id, null, true);
  if v_flag.version <> p_expected_version or v_flag.status = 'resolved' then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if p_replacement_release_id is not null then
    select * into v_replacement from public.releases
    where id = p_replacement_release_id and job_id = v_flag.job_id
      and supersedes_release_id = v_flag.release_id
      and allow_predecessor_visitors = true for key share;
    if not found then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  end if;
  insert into public.flag_responses (
    workspace_id, job_id, release_id, flag_id, flag_version,
    text, author_id, kind, replacement_release_id
  ) values (
    v_flag.workspace_id, v_flag.job_id, v_flag.release_id, v_flag.id,
    v_flag.version + 1, btrim(p_text), p_actor_id, p_kind, p_replacement_release_id
  );
  update public.flags set version = version + 1, status = 'responded' where id = v_flag.id;
  return private.feedback_flag_payload_internal(v_flag.id);
end;
$function$;

create or replace function public.record_release_question_internal(
  p_question_id uuid, p_release_id uuid, p_actor_id uuid, p_session_hash text,
  p_step_id uuid, p_bend_id text, p_question text, p_answer jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_actor jsonb;
begin
  if p_question_id is null or p_release_id is null
    or length(btrim(coalesce(p_question, ''))) not between 3 and 2000
    or jsonb_typeof(p_answer) is distinct from 'object'
    or p_answer->>'id' is distinct from p_question_id::text
    or p_answer->'context'->>'releaseId' is distinct from p_release_id::text
    or p_answer->'context'->>'stepId' is distinct from p_step_id::text
    or p_answer->'context'->>'bendId' is distinct from p_bend_id then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  v_actor := private.feedback_actor_internal(p_release_id, p_actor_id, p_session_hash, false);
  perform private.feedback_check_context_internal(p_release_id, p_step_id, p_bend_id);
  insert into public.questions (
    id, workspace_id, job_id, release_id, step_id, bend_id,
    question, actor_kind, actor_user_id, actor_session_id, answer
  ) values (
    p_question_id, (v_actor->>'workspaceId')::uuid, (v_actor->>'jobId')::uuid,
    p_release_id, p_step_id, p_bend_id, btrim(p_question),
    v_actor->>'kind', case when p_actor_id is not null then p_actor_id else null end,
    case when p_actor_id is null then (v_actor->>'actorId')::uuid else null end,
    p_answer
  );
  return p_answer;
end;
$function$;

revoke all on function private.feedback_actor_internal(uuid,uuid,text,boolean) from public, anon, authenticated;
revoke all on function private.feedback_check_context_internal(uuid,uuid,text) from public, anon, authenticated;
revoke all on function private.feedback_flag_payload_internal(uuid) from public, anon, authenticated;
revoke all on function public.list_visitor_release_flags_internal(uuid,text) from public, anon, authenticated;
revoke all on function public.create_release_flag_internal(uuid,uuid,uuid,text,uuid,text,text,uuid[],text,text) from public, anon, authenticated;
revoke all on function public.respond_release_flag_internal(uuid,uuid,integer,text,text,uuid) from public, anon, authenticated;
revoke all on function public.record_release_question_internal(uuid,uuid,uuid,text,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function private.feedback_actor_internal(uuid,uuid,text,boolean) to service_role;
grant execute on function private.feedback_check_context_internal(uuid,uuid,text) to service_role;
grant execute on function private.feedback_flag_payload_internal(uuid) to service_role;
grant execute on function public.list_visitor_release_flags_internal(uuid,text) to service_role;
grant execute on function public.create_release_flag_internal(uuid,uuid,uuid,text,uuid,text,text,uuid[],text,text) to service_role;
grant execute on function public.respond_release_flag_internal(uuid,uuid,integer,text,text,uuid) to service_role;
grant execute on function public.record_release_question_internal(uuid,uuid,uuid,text,uuid,text,text,jsonb) to service_role;
