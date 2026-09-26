-- An approved reply does not, by itself, clear a hold on the affected work.
alter table public.demo_issues
  add column hold_active boolean not null default true;
comment on column public.demo_issues.hold_active is 'An answer can inform the operator while this affected demo operation remains on hold; only an explicit engineer decision clears it.';
