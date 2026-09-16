-- Complete foreign-key coverage reported by the database advisor.
create index approval_steps_acted_by_idx
  on public.approval_steps(acted_by)
  where acted_by is not null;

create index approval_steps_approver_department_idx
  on public.approval_steps(approver_department_id)
  where approver_department_id is not null;

-- These tables are server-managed only. Explicit deny policies document that
-- authenticated clients must not read or write them directly.
create policy role_permissions_no_direct_access
on public.role_permissions
for all
to authenticated
using (false)
with check (false);

create policy line_webhook_events_no_direct_access
on public.line_webhook_events
for all
to authenticated
using (false)
with check (false);
