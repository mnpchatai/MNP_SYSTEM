-- Read names for role-based MT action owners without exposing module grants.
-- Explicit technicians/requesters are already available to the dashboard.
-- Reuse the notification recipients, including assistant managers and Admin fallback.
-- Recovery: drop function public.app_mt_dashboard_role_owners(uuid[]).
create or replace function public.app_mt_dashboard_role_owners(p_request_ids uuid[])
returns table (request_id uuid, status text, current_step integer, employee_id uuid, full_name text, is_fallback boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if private.current_employee_id() is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;
  if coalesce(cardinality(p_request_ids), 0) > 500 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;

  return query
  with visible as materialized (
    select r.id, r.status, r.current_step
    from public.requests r
    join public.request_types t on t.id = r.request_type_id and t.code = 'MT_REPAIR'
    where r.id = any(p_request_ids)
      and r.status in ('pending_approval', 'pending_assign')
      and private.can_access_request(r.id)
  ), owners as (
    select r.id, r.status, r.current_step, a.employee_id, a.is_fallback
    from visible r
    join public.approval_steps s on s.request_id = r.id
      and s.step_order = r.current_step and s.status = 'pending'
    cross join lateral private.approval_step_recipients(s.id) a
    where r.status = 'pending_approval'
    union all
    select r.id, r.status, r.current_step, m.employee_id, false
    from visible r
    cross join lateral private.owning_department_managers(r.id) m
    where r.status = 'pending_assign'
  )
  select distinct o.id, o.status::text, o.current_step, e.id,
    btrim(concat_ws(' ', e.first_name, e.last_name)), o.is_fallback
  from owners o
  join public.employees e on e.id = o.employee_id and e.is_active
  order by o.id, e.id;
end;
$$;
revoke all on function public.app_mt_dashboard_role_owners(uuid[]) from public, anon;
grant execute on function public.app_mt_dashboard_role_owners(uuid[]) to authenticated;
