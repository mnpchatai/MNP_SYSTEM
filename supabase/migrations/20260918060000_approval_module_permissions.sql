-- สิทธิ์อนุมัติแยกตามโมดูล (request_types)
--
-- เดิมใครก็ตามที่ถือ role = final_approver_role_id ของประเภทคำร้อง (ปกติคือ 'approver')
-- และอยู่แผนกเจ้าของประเภทคำร้องนั้น จะอนุมัติได้ทุกโมดูลที่แผนกตนรับผิดชอบทันที ตอนนี้ Admin
-- ต้องกำหนดเพิ่มอีกชั้นว่าผู้อนุมัติแต่ละคนอนุมัติโมดูลไหนได้บ้าง (เช่น MT, ห้องบริหาร)
-- ก่อนเปิดทดสอบแจ้งเตือนอีเมลจริง
--
-- ตารางนี้ปิดการเข้าถึงตรงทั้งหมดเหมือน account_requests/account_credentials อ่าน/เขียนได้
-- เฉพาะผ่าน RPC ที่ตรวจสิทธิ์ 'approvals.manage' (Admin เท่านั้น) ยกเว้นผู้ใช้ดูสิทธิ์ของตัวเองได้
-- ผ่าน app_my_approval_modules

-- 1. ตารางสิทธิ์
create table public.approval_module_permissions (
  employee_id uuid not null references public.employees(id) on delete cascade,
  request_type_id uuid not null references public.request_types(id) on delete cascade,
  granted_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (employee_id, request_type_id)
);

create index approval_module_permissions_type_idx
  on public.approval_module_permissions(request_type_id);
create index approval_module_permissions_granted_by_idx
  on public.approval_module_permissions(granted_by)
  where granted_by is not null;

revoke all on public.approval_module_permissions from anon, authenticated;
alter table public.approval_module_permissions enable row level security;

create policy approval_module_permissions_no_direct_access on public.approval_module_permissions
for all to authenticated using (false) with check (false);

-- entity_id ใช้ employee_id (ตารางนี้ไม่มีคอลัมน์ id เดี่ยว) ส่วน request_type_id ที่ให้/ถอด
-- ยังอยู่ครบใน metadata.old/new เหมือน audit ตารางอื่น
create or replace function private.audit_approval_module_permission_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    private.current_employee_id(),
    tg_op,
    tg_table_name,
    coalesce((to_jsonb(new)->>'employee_id'), (to_jsonb(old)->>'employee_id')),
    jsonb_build_object('old', case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
                       'new', case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end)
  );
  return coalesce(new, old);
end;
$$;

revoke all on function private.audit_approval_module_permission_change() from public, anon, authenticated;

create trigger approval_module_permissions_audit
after insert or update or delete on public.approval_module_permissions
for each row execute function private.audit_approval_module_permission_change();

-- 2. สิทธิ์ใหม่สำหรับผู้ดูแลระบบ: กำหนดว่าใครอนุมัติโมดูลไหนได้บ้าง
insert into public.permissions (code, description)
values ('approvals.manage', 'Configure which modules each approver may approve')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r, public.permissions p
where r.code = 'admin' and p.code = 'approvals.manage'
on conflict do nothing;

-- 3. ผู้อนุมัติทุกคนที่มีอยู่แล้ววันนี้ยังอนุมัติได้ทุกโมดูลที่ตนอนุมัติอยู่แล้วต่อไป
--    (คงพฤติกรรมเดิมทันทีหลัง migrate) จากนี้ไป Admin เป็นผู้ให้/ถอดสิทธิ์เพิ่มเติมเอง
--    ยกเว้นบทบาทที่มี requests.view_all (เช่น admin) ซึ่ง bypass กฎนี้อยู่แล้วในทุกจุดตรวจสิทธิ์
--    จึงไม่จำเป็นต้องมีแถวสิทธิ์ให้ยุ่งฟรี
insert into public.approval_module_permissions (employee_id, request_type_id, granted_by)
select distinct e.id, t.id, null::uuid
from public.employees e
join public.role_permissions rp on rp.role_id = e.role_id
join public.permissions p on p.id = rp.permission_id and p.code = 'approvals.act'
cross join public.request_types t
where e.is_active
  and t.is_active
  and not exists (
    select 1
    from public.role_permissions rp2
    join public.permissions p2 on p2.id = rp2.permission_id
    where rp2.role_id = e.role_id and p2.code = 'requests.view_all'
  )
on conflict do nothing;

-- 4. ผู้ช่วยตรวจสิทธิ์ฝั่งฐานข้อมูล ใช้ทั้งใน RLS และ RPC อนุมัติ
create or replace function private.can_approve_module(p_employee_id uuid, p_request_type_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.approval_module_permissions m
    where m.employee_id = p_employee_id and m.request_type_id = p_request_type_id
  )
$$;

revoke all on function private.can_approve_module(uuid, uuid) from public;
grant execute on function private.can_approve_module(uuid, uuid) to authenticated;

-- 5. ขั้นอนุมัติที่ผูกกับ role (ไม่ใช่หัวหน้าแผนกที่ผูกกับตัวบุคคล) ต้องมีสิทธิ์โมดูลนั้นด้วย
--    ทั้งฝั่งมองเห็น (RLS) และฝั่งกดอนุมัติจริง (app_approval_decision)
create or replace function private.can_access_request(target_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.requests r
    join public.employees me on me.auth_user_id = (select auth.uid()) and me.is_active
    where r.id = target_request_id
      and (
        r.requester_id = me.id
        or r.assignee_id = me.id
        or exists (
          select 1 from public.approval_steps s
          where s.request_id = r.id
            and (
              s.approver_employee_id = me.id
              or (
                s.approver_role_id = me.role_id
                and (s.approver_department_id is null or s.approver_department_id = me.department_id)
                and private.can_approve_module(me.id, r.request_type_id)
              )
            )
        )
        or private.has_permission('requests.view_all')
        or (
          private.has_permission('requests.operate')
          and r.status in ('approved', 'in_progress')
        )
      )
  )
$$;

revoke all on function private.can_access_request(uuid) from public;
grant execute on function private.can_access_request(uuid) to authenticated;

-- 6. บันทึกการตัดสินใจอนุมัติ — เพิ่มการตรวจสิทธิ์โมดูลในสาขาที่อนุมัติแบบ role และกรองผู้รับ
--    แจ้งเตือนขั้นถัดไปให้เหลือเฉพาะคนที่อนุมัติโมดูลนี้ได้จริง (ตรรกะอื่นเหมือนไฟล์
--    20260918030000_repair_workflow_rpcs.sql ทุกประการ)
create or replace function public.app_approval_decision(p_step_id uuid, p_decision text, p_comment text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_step public.approval_steps%rowtype;
  v_request public.requests%rowtype;
  v_next public.approval_steps%rowtype;
  v_is_admin boolean;
  v_uses_repair boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_decision not in ('approved', 'rejected', 'more_info') then
    raise exception 'INVALID_DECISION';
  end if;

  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_employee.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  select * into v_step
  from public.approval_steps
  where id = p_step_id
  for update;
  if v_step.id is null or v_step.status <> 'pending' then
    raise exception 'STEP_NOT_PENDING';
  end if;

  select * into v_request
  from public.requests
  where id = v_step.request_id
  for update;
  if v_request.status <> 'pending_approval' or v_request.current_step <> v_step.step_order then
    raise exception 'STEP_NOT_CURRENT';
  end if;

  v_is_admin := private.has_permission('requests.view_all');
  if not v_is_admin and not (
    (v_step.approver_employee_id = v_employee.id)
    or (
      v_step.approver_role_id = v_employee.role_id
      and (v_step.approver_department_id is null or v_step.approver_department_id = v_employee.department_id)
      and private.has_permission('approvals.act')
      and private.can_approve_module(v_employee.id, v_request.request_type_id)
    )
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.approval_steps
  set status = p_decision::public.approval_status,
      acted_by = v_employee.id,
      acted_at = now(),
      comment = nullif(left(trim(coalesce(p_comment, '')), 1000), '')
  where id = v_step.id and status = 'pending';

  if p_decision in ('rejected', 'more_info') then
    update public.requests
    set status = case when p_decision = 'rejected'
                      then 'rejected'::public.request_status
                      else 'more_info'::public.request_status end,
        last_changed_by = v_employee.id
    where id = v_request.id;
  else
    select * into v_next
    from public.approval_steps
    where request_id = v_request.id
      and status = 'pending'
      and step_order > v_step.step_order
    order by step_order
    limit 1;

    if v_next.id is null then
      select uses_repair_workflow into v_uses_repair
      from public.request_types
      where id = v_request.request_type_id;

      update public.requests
      set status = case when coalesce(v_uses_repair, false)
                        then 'pending_assign'::public.request_status
                        else 'approved'::public.request_status end,
          current_step = 0, approved_at = now(),
          last_changed_by = v_employee.id
      where id = v_request.id;
    else
      update public.requests
      set current_step = v_next.step_order, last_changed_by = v_employee.id
      where id = v_request.id;

      if v_next.approver_employee_id is not null then
        insert into public.notifications (recipient_id, request_id, title, body, action_url)
        values (
          v_next.approver_employee_id, v_request.id, 'มีคำร้องรออนุมัติ',
          v_request.request_no || ' · ' || v_next.step_name,
          '/requests/' || v_request.id::text
        );
      else
        insert into public.notifications (recipient_id, request_id, title, body, action_url)
        select e.id, v_request.id, 'มีคำร้องรออนุมัติ',
               v_request.request_no || ' · ' || v_next.step_name,
               '/requests/' || v_request.id::text
        from public.employees e
        where e.role_id = v_next.approver_role_id
          and e.is_active
          and (v_next.approver_department_id is null or e.department_id = v_next.approver_department_id)
          and private.can_approve_module(e.id, v_request.request_type_id);
      end if;
    end if;
  end if;

  return v_request.id;
end;
$$;

revoke all on function public.app_approval_decision(uuid, text, text) from public, anon;
grant execute on function public.app_approval_decision(uuid, text, text) to authenticated;

-- 7. สร้างคำร้องทั่วไป — กรองผู้รับแจ้งเตือนขั้นอนุมัติแรกเหลือเฉพาะคนที่อนุมัติโมดูลนี้ได้
--    (ตรรกะอื่นเหมือนไฟล์ 20260917062000_approval_step_approver_fallback.sql ทุกประการ)
create or replace function public.app_create_request(
  p_type_id uuid,
  p_title text,
  p_description text,
  p_priority text default 'normal',
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_type public.request_types%rowtype;
  v_request public.requests%rowtype;
  v_step integer := 0;
  v_final_role uuid;
  v_final_department uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;

  if v_employee.id is null or not private.has_permission('requests.create') then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 3 and 200 then
    raise exception 'INVALID_TITLE';
  end if;
  if char_length(trim(coalesce(p_description, ''))) not between 3 and 5000 then
    raise exception 'INVALID_DESCRIPTION';
  end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'INVALID_PRIORITY';
  end if;
  if jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_DETAILS';
  end if;

  select * into v_type
  from public.request_types
  where id = p_type_id and is_active
  limit 1;
  if v_type.id is null then
    raise exception 'REQUEST_TYPE_NOT_FOUND';
  end if;

  insert into public.requests (
    request_type_id, requester_id, department_id, title, description,
    details, priority, status, current_step, last_changed_by
  ) values (
    v_type.id, v_employee.id, v_employee.department_id, trim(p_title),
    trim(p_description), coalesce(p_details, '{}'::jsonb),
    p_priority::public.request_priority, 'pending_approval', 1, v_employee.id
  ) returning * into v_request;

  -- An inactive manager cannot act, so that step would strand the request.
  if v_type.requires_manager_approval and exists (
    select 1 from public.employees m
    where m.id = v_employee.manager_id and m.is_active
  ) then
    v_step := v_step + 1;
    insert into public.approval_steps (
      request_id, step_order, step_name, approver_employee_id
    ) values (v_request.id, v_step, 'หัวหน้าแผนก', v_employee.manager_id);

    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    values (
      v_employee.manager_id, v_request.id, 'มีคำร้องรออนุมัติ',
      v_request.request_no || ' · ' || v_request.title,
      '/requests/' || v_request.id::text
    );
  end if;

  if v_type.final_approver_role_id is not null then
    select t.approver_role_id, t.approver_department_id
      into v_final_role, v_final_department
    from private.resolve_approval_target(
      v_type.final_approver_role_id, v_type.owning_department_id
    ) t;

    v_step := v_step + 1;
    insert into public.approval_steps (
      request_id, step_order, step_name, approver_role_id, approver_department_id
    ) values (
      v_request.id, v_step, 'ผู้อนุมัติหน่วยงานรับผิดชอบ',
      v_final_role, v_final_department
    );

    if v_step = 1 then
      insert into public.notifications (recipient_id, request_id, title, body, action_url)
      select e.id, v_request.id, 'มีคำร้องรออนุมัติ',
             v_request.request_no || ' · ' || v_request.title,
             '/requests/' || v_request.id::text
      from public.employees e
      where e.role_id = v_final_role
        and e.is_active
        and (v_final_department is null or e.department_id = v_final_department)
        and private.can_approve_module(e.id, v_type.id);
    end if;
  end if;

  if v_step = 0 then
    update public.requests
    set status = 'approved', current_step = 0
    where id = v_request.id;
  end if;

  insert into public.request_status_history (
    request_id, from_status, to_status, changed_by, note
  ) values (
    v_request.id, null, 'pending_approval', v_employee.id, 'สร้างและส่งคำร้องผ่าน Pilot Web'
  );

  return v_request.id;
end;
$$;

revoke all on function public.app_create_request(uuid, text, text, text, jsonb) from anon;

-- 8. สร้างใบแจ้งซ่อม — กรองผู้รับแจ้งเตือนเช่นเดียวกับ app_create_request
--    (ตรรกะอื่นเหมือนไฟล์ 20260918030000_repair_workflow_rpcs.sql ทุกประการ)
create or replace function public.app_create_repair_request(
  p_department_id uuid,
  p_machine_id uuid,
  p_doc_type text,
  p_description text,
  p_is_urgent boolean default false,
  p_needed_date date default null,
  p_requester_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_type public.request_types%rowtype;
  v_department public.departments%rowtype;
  v_machine public.machines%rowtype;
  v_request public.requests%rowtype;
  v_requester_name text;
  v_title text;
  v_step integer := 0;
  v_final_role uuid;
  v_final_department uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_employee.id is null or not private.has_permission('requests.create') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_doc_type not in ('request', 'repair') then
    raise exception 'INVALID_DOC_TYPE';
  end if;
  if char_length(trim(coalesce(p_description, ''))) not between 3 and 5000 then
    raise exception 'INVALID_DESCRIPTION';
  end if;

  select * into v_department
  from public.departments
  where id = p_department_id and is_active and is_repair_site
  limit 1;
  if v_department.id is null then
    raise exception 'DEPARTMENT_NOT_REPAIR_SITE';
  end if;

  select * into v_machine
  from public.machines
  where id = p_machine_id and department_id = v_department.id and is_active
  limit 1;
  if v_machine.id is null then
    raise exception 'MACHINE_NOT_FOUND';
  end if;

  select * into v_type
  from public.request_types
  where code = 'MT_REPAIR' and is_active
  limit 1;
  if v_type.id is null then
    raise exception 'REQUEST_TYPE_NOT_FOUND';
  end if;

  v_requester_name := nullif(trim(coalesce(p_requester_name, '')), '');
  if v_requester_name is null then
    v_requester_name := trim(v_employee.first_name || ' ' || v_employee.last_name);
  end if;
  v_title := left(trim(v_machine.name || ' — ' || trim(p_description)), 200);

  insert into public.requests (
    request_type_id, requester_id, department_id, title, description,
    details, priority, status, current_step, last_changed_by,
    doc_type, machine_id, machine_code, machine_name, needed_date,
    is_urgent, requester_name
  ) values (
    v_type.id, v_employee.id, v_department.id, v_title, trim(p_description),
    '{}'::jsonb,
    case when coalesce(p_is_urgent, false) then 'urgent' else 'normal' end::public.request_priority,
    'pending_approval', 1, v_employee.id,
    p_doc_type, v_machine.id, v_machine.code, v_machine.name, p_needed_date,
    coalesce(p_is_urgent, false), v_requester_name
  ) returning * into v_request;

  -- โครงขั้นอนุมัติเดียวกับ app_create_request: หัวหน้าแผนกผู้แจ้ง (ถ้ามีและยัง active)
  -- แล้วต่อด้วยผู้อนุมัติของหน่วยงานเจ้าของประเภทเอกสาร (แผนกซ่อมบำรุง)
  if v_type.requires_manager_approval and exists (
    select 1 from public.employees m
    where m.id = v_employee.manager_id and m.is_active
  ) then
    v_step := v_step + 1;
    insert into public.approval_steps (
      request_id, step_order, step_name, approver_employee_id
    ) values (v_request.id, v_step, 'หัวหน้าแผนก', v_employee.manager_id);

    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    values (
      v_employee.manager_id, v_request.id, 'มีคำร้องรออนุมัติ',
      v_request.request_no || ' · ' || v_request.title,
      '/requests/' || v_request.id::text
    );
  end if;

  if v_type.final_approver_role_id is not null then
    select t.approver_role_id, t.approver_department_id
      into v_final_role, v_final_department
    from private.resolve_approval_target(
      v_type.final_approver_role_id, v_type.owning_department_id
    ) t;

    v_step := v_step + 1;
    insert into public.approval_steps (
      request_id, step_order, step_name, approver_role_id, approver_department_id
    ) values (
      v_request.id, v_step, 'ผู้อนุมัติหน่วยงานรับผิดชอบ',
      v_final_role, v_final_department
    );

    if v_step = 1 then
      insert into public.notifications (recipient_id, request_id, title, body, action_url)
      select e.id, v_request.id, 'มีคำร้องรออนุมัติ',
             v_request.request_no || ' · ' || v_request.title,
             '/requests/' || v_request.id::text
      from public.employees e
      where e.role_id = v_final_role
        and e.is_active
        and (v_final_department is null or e.department_id = v_final_department)
        and private.can_approve_module(e.id, v_type.id);
    end if;
  end if;

  -- ไม่มีขั้นอนุมัติเลย (ผู้แจ้งไม่มีหัวหน้า active และ type ไม่ตั้ง final approver) —
  -- ใบแจ้งซ่อมข้ามไป pending_assign ตรงๆ ต่างจาก app_create_request ที่ข้ามไป approved
  if v_step = 0 then
    update public.requests
    set status = 'pending_assign', current_step = 0
    where id = v_request.id;
  end if;

  insert into public.request_status_history (
    request_id, from_status, to_status, changed_by, note
  ) values (
    v_request.id, null, 'pending_approval', v_employee.id, 'สร้างใบแจ้งซ่อมผ่าน Pilot Web'
  );

  return v_request.id;
end;
$$;

revoke all on function public.app_create_repair_request(uuid, uuid, text, text, boolean, date, text) from public, anon;
grant execute on function public.app_create_repair_request(uuid, uuid, text, text, boolean, date, text) to authenticated;

-- 9. Admin: ตารางสิทธิ์อนุมัติของทุกคนที่อนุมัติได้ (role มี permission 'approvals.act') คูณ
--    ทุกโมดูลที่เปิดใช้งาน พร้อมสถานะว่าให้สิทธิ์แล้วหรือยัง ใช้เรนเดอร์เป็นตาราง checkbox
create or replace function public.app_list_module_permissions()
returns table (
  employee_id uuid,
  employee_no text,
  full_name text,
  department_code text,
  role_code text,
  request_type_id uuid,
  request_type_code text,
  request_type_name text,
  granted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.employee_no, e.first_name || ' ' || e.last_name, d.code, r.code,
         t.id, t.code, t.name_th,
         (m.employee_id is not null)
  from public.employees e
  join public.roles r on r.id = e.role_id
  join public.role_permissions rp on rp.role_id = r.id
  join public.permissions p on p.id = rp.permission_id and p.code = 'approvals.act'
  join public.departments d on d.id = e.department_id
  cross join public.request_types t
  left join public.approval_module_permissions m
    on m.employee_id = e.id and m.request_type_id = t.id
  where private.has_permission('approvals.manage')
    and e.is_active
    and t.is_active
    and not exists (
      select 1
      from public.role_permissions rp2
      join public.permissions p2 on p2.id = rp2.permission_id
      where rp2.role_id = e.role_id and p2.code = 'requests.view_all'
    )
  order by e.employee_no, t.sort_order
$$;

revoke all on function public.app_list_module_permissions() from public, anon;
grant execute on function public.app_list_module_permissions() to authenticated;

-- 10. Admin: ให้/ถอดสิทธิ์อนุมัติโมดูลหนึ่งของพนักงานคนหนึ่ง
create or replace function public.app_set_module_permission(
  p_employee_id uuid,
  p_request_type_id uuid,
  p_granted boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_actor
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_actor.id is null or not private.has_permission('approvals.manage') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if not exists (select 1 from public.employees where id = p_employee_id) then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;
  if not exists (select 1 from public.request_types where id = p_request_type_id) then
    raise exception 'REQUEST_TYPE_NOT_FOUND';
  end if;

  if coalesce(p_granted, false) then
    insert into public.approval_module_permissions (employee_id, request_type_id, granted_by)
    values (p_employee_id, p_request_type_id, v_actor.id)
    on conflict (employee_id, request_type_id) do nothing;
  else
    delete from public.approval_module_permissions
    where employee_id = p_employee_id and request_type_id = p_request_type_id;
  end if;
end;
$$;

revoke all on function public.app_set_module_permission(uuid, uuid, boolean) from public, anon;
grant execute on function public.app_set_module_permission(uuid, uuid, boolean) to authenticated;

-- 11. ผู้ใช้ทุกคนดูรายการโมดูลที่ตนเองอนุมัติได้ (ใช้กรองหน้า "รออนุมัติ" ฝั่งไคลเอนต์)
create or replace function public.app_my_approval_modules()
returns table (request_type_id uuid, code text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.code
  from public.approval_module_permissions m
  join public.request_types t on t.id = m.request_type_id
  join public.employees e on e.id = m.employee_id
  where e.auth_user_id = (select auth.uid()) and e.is_active
$$;

revoke all on function public.app_my_approval_modules() from public, anon;
grant execute on function public.app_my_approval_modules() to authenticated;
