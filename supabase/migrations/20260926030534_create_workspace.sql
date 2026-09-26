-- A newly verified account creates its first workspace through a server-only,
-- atomic RPC. The idempotency claim is checked and completed in the same
-- transaction as both inserts, so retrying cannot leave an orphan workspace.
create or replace function public.create_workspace_internal(
  p_actor_id uuid,
  p_workspace_id uuid,
  p_membership_id uuid,
  p_name text,
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
  v_created_at timestamptz;
  v_membership_created_at timestamptz;
  v_result jsonb;
begin
  if p_actor_id is null or p_workspace_id is null or p_membership_id is null
    or length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  select * into v_claim
  from public.idempotency_records
  where id = p_idempotency_record_id
  for update;

  if not found or v_claim.actor_kind <> 'member' or v_claim.actor_id <> p_actor_id
    or v_claim.operation <> 'workspace.create' or v_claim.state <> 'running'
    or v_claim.claim_token <> p_idempotency_claim_token
    or v_claim.lease_expires_at <= clock_timestamp() then
    raise exception 'IDEMPOTENCY_CLAIM_LOST' using errcode = '40001';
  end if;

  insert into public.workspaces (id, name, created_by)
  values (p_workspace_id, btrim(p_name), p_actor_id)
  returning created_at into v_created_at;

  insert into public.workspace_members (id, workspace_id, user_id, role, status)
  values (p_membership_id, p_workspace_id, p_actor_id, 'admin', 'active')
  returning created_at into v_membership_created_at;

  v_result := jsonb_build_object(
    'workspace', jsonb_build_object(
      'id', p_workspace_id, 'name', btrim(p_name), 'createdAt', v_created_at
    ),
    'membership', jsonb_build_object(
      'id', p_membership_id, 'workspaceId', p_workspace_id,
      'userId', p_actor_id, 'role', 'admin', 'createdAt', v_membership_created_at
    )
  );
  perform private.complete_idempotency(
    p_idempotency_record_id, p_idempotency_claim_token, v_result, p_workspace_id
  );
  return v_result;
end;
$function$;

revoke all on function public.create_workspace_internal(uuid, uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_workspace_internal(uuid, uuid, uuid, text, uuid, uuid)
  to service_role;
