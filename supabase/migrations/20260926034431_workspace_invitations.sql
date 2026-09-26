-- Invite links are issued by an active workspace admin and redeemable once by
-- the verified Supabase account whose email was named at issue time. Only a
-- SHA-256 token digest is stored; the raw bearer token stays in the issued URL.
alter table public.workspace_invites
  add column if not exists invited_email text;

create index if not exists workspace_invites_recipient_idx
  on public.workspace_invites (workspace_id, invited_email)
  where redeemed_at is null and revoked_at is null;

create or replace function public.issue_workspace_invite_internal(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_invite_id uuid,
  p_token_hash text,
  p_invited_email text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_invite public.workspace_invites%rowtype;
  v_email text := lower(btrim(coalesce(p_invited_email, '')));
begin
  if p_workspace_id is null or p_actor_id is null or p_invite_id is null
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_role not in ('designer', 'fabricator')
    or length(v_email) not between 3 and 254 or position('@' in v_email) < 2 then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  -- Lock the authorizing membership so revocation and issuance are ordered.
  perform 1 from public.workspace_members as wm
  where wm.workspace_id = p_workspace_id and wm.user_id = p_actor_id
    and wm.role = 'admin' and wm.status = 'active'
  for update;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  insert into public.workspace_invites (
    id, workspace_id, token_hash, invited_email, role, created_by, expires_at
  ) values (
    p_invite_id, p_workspace_id, p_token_hash, v_email, p_role,
    p_actor_id, clock_timestamp() + interval '7 days'
  ) on conflict (token_hash) do nothing;

  select * into v_invite from public.workspace_invites
  where token_hash = p_token_hash for update;
  if v_invite.workspace_id is distinct from p_workspace_id
    or v_invite.created_by is distinct from p_actor_id
    or v_invite.invited_email is distinct from v_email
    or v_invite.role is distinct from p_role then
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
  end if;
  if v_invite.revoked_at is not null or v_invite.redeemed_at is not null
    or v_invite.expires_at <= clock_timestamp() then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', v_invite.id, 'workspaceId', v_invite.workspace_id,
    'role', v_invite.role, 'invitedEmail', v_invite.invited_email,
    'createdAt', v_invite.created_at, 'expiresAt', v_invite.expires_at
  );
end;
$function$;

create or replace function public.redeem_workspace_invite_internal(
  p_actor_id uuid,
  p_membership_id uuid,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_invite public.workspace_invites%rowtype;
  v_user auth.users%rowtype;
  v_member public.workspace_members%rowtype;
begin
  if p_actor_id is null or p_membership_id is null
    or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;

  select * into v_invite from public.workspace_invites
  where token_hash = p_token_hash for update;
  if not found or v_invite.revoked_at is not null
    or (v_invite.redeemed_by is null and v_invite.expires_at <= clock_timestamp()) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_user from auth.users where id = p_actor_id;
  if not found or v_user.email_confirmed_at is null
    or v_invite.invited_email is null
    or lower(btrim(coalesce(v_user.email, ''))) is distinct from v_invite.invited_email then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_invite.redeemed_by is not null and v_invite.redeemed_by <> p_actor_id then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_member from public.workspace_members
  where workspace_id = v_invite.workspace_id and user_id = p_actor_id for update;
  if v_invite.redeemed_by is not null then
    if not found or v_member.status <> 'active' or v_member.role <> v_invite.role then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  if found then
    if v_member.status = 'active' and v_member.role <> v_invite.role then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if v_member.status = 'revoked' then
      update public.workspace_members
      set status = 'active', role = v_invite.role, invited_by = v_invite.created_by
      where id = v_member.id returning * into v_member;
    end if;
  else
    insert into public.workspace_members (
      id, workspace_id, user_id, role, status, invited_by
    ) values (
      p_membership_id, v_invite.workspace_id, p_actor_id,
      v_invite.role, 'active', v_invite.created_by
    ) returning * into v_member;
  end if;

  if v_invite.redeemed_by is null then
    update public.workspace_invites
    set redeemed_by = p_actor_id, redeemed_at = clock_timestamp()
    where id = v_invite.id;
  end if;

  return jsonb_build_object(
    'id', v_member.id, 'workspaceId', v_member.workspace_id,
    'userId', v_member.user_id, 'role', v_member.role,
    'createdAt', v_member.created_at
  );
end;
$function$;

revoke all on function public.issue_workspace_invite_internal(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.redeem_workspace_invite_internal(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.issue_workspace_invite_internal(uuid, uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.redeem_workspace_invite_internal(uuid, uuid, text)
  to service_role;
