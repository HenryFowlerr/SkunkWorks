-- Keep the prepared QR demo's raw operator statement separate from the
-- assistant-generated draft. Neither field is an approved engineering change.
alter table public.demo_issues
  add column report_type text not null default 'none' check (report_type in ('none', 'assist', 'escalation')),
  add column operator_outcome text check (operator_outcome is null or operator_outcome in ('resolved', 'blocked')),
  add column report_summary text check (report_summary is null or char_length(btrim(report_summary)) between 1 and 500),
  add column recommendation text check (recommendation is null or char_length(btrim(recommendation)) between 1 and 500),
  add constraint demo_issue_assistance_shape check (
    (report_type = 'none' and operator_outcome is null)
    or (report_type = 'assist' and operator_outcome = 'resolved')
    or (report_type = 'escalation' and operator_outcome = 'blocked')
  );

comment on column public.demo_issues.report_type is 'Prepared demo assistance classification; never an approval or a safety decision.';
comment on column public.demo_issues.operator_outcome is 'The operator-reported outcome. A resolved assist is an improvement candidate, not a released change.';
comment on column public.demo_issues.report_summary is 'Assistant draft summary for engineering review only.';
comment on column public.demo_issues.recommendation is 'Assistant draft recommendation for engineering review only.';
