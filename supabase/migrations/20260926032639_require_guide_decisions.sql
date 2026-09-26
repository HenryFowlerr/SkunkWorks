-- A release contains the complete process sequence, but every operation must
-- have an explicit engineer decision about detailed phone guidance. This also
-- protects publication paths that bypass the TypeScript domain gate.
create or replace function private.release_guide_decisions_complete(p_snapshot jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if jsonb_typeof(p_snapshot->'steps') is distinct from 'array' then
    return false;
  end if;

  return not exists (
    select 1
    from jsonb_array_elements(p_snapshot->'steps') as step
    where coalesce(step #>> '{guidance,decision}', '') not in ('include', 'exclude')
  );
end;
$function$;

alter table public.releases
  add constraint releases_guide_decisions_complete
  check (private.release_guide_decisions_complete(snapshot));
