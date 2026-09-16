-- MNP Internal System — Phase 1
-- Core identity, request center, approvals, audit, notifications, attachments and LINE linking.

create schema if not exists private;

create type public.request_status as enum (
  'draft', 'pending_approval', 'approved', 'in_progress',
  'more_info', 'completed', 'rejected', 'cancelled'
);
create type public.request_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.approval_status as enum ('pending', 'approved', 'rejected', 'more_info', 'skipped');

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null,
  name_en text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  employee_no text not null unique,
  first_name text not null,
  last_name text not null,
  email text not null unique,
  phone text,
  job_title text,
  department_id uuid not null references public.departments(id),
  role_id uuid not null references public.roles(id),
  manager_id uuid references public.employees(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.request_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  prefix text not null unique,
  name_th text not null,
  name_en text not null,
  description text,
  icon text not null default 'clipboard-list',
  owning_department_id uuid references public.departments(id),
  final_approver_role_id uuid references public.roles(id),
  requires_manager_approval boolean not null default true,
  form_schema jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.request_number_seq start 1;

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  request_type_id uuid not null references public.request_types(id),
  requester_id uuid not null references public.employees(id),
  department_id uuid not null references public.departments(id),
  title text not null check (char_length(title) between 3 and 200),
  description text not null check (char_length(description) between 3 and 5000),
  details jsonb not null default '{}'::jsonb,
  priority public.request_priority not null default 'normal',
  status public.request_status not null default 'pending_approval',
  current_step integer not null default 1 check (current_step >= 0),
  assignee_id uuid references public.employees(id) on delete set null,
  last_changed_by uuid references public.employees(id) on delete set null,
  submitted_at timestamptz not null default now(),
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.approval_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  step_order integer not null check (step_order > 0),
  step_name text not null,
  approver_employee_id uuid references public.employees(id) on delete set null,
  approver_role_id uuid references public.roles(id) on delete set null,
  approver_department_id uuid references public.departments(id) on delete set null,
  status public.approval_status not null default 'pending',
  acted_by uuid references public.employees(id) on delete set null,
  acted_at timestamptz,
  comment text,
  created_at timestamptz not null default now(),
  unique (request_id, step_order),
  check (approver_employee_id is not null or approver_role_id is not null)
);

create table public.request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  author_id uuid not null references public.employees(id),
  body text not null check (char_length(body) between 1 and 3000),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  uploader_id uuid not null references public.employees(id),
  storage_path text not null unique,
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at timestamptz not null default now()
);

create table public.request_status_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  from_status public.request_status,
  to_status public.request_status not null,
  changed_by uuid references public.employees(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.employees(id) on delete cascade,
  request_id uuid references public.requests(id) on delete cascade,
  title text not null,
  body text not null,
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.employees(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.line_accounts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  line_user_id text not null unique,
  display_name text,
  picture_url text,
  rich_menu_id text,
  is_verified boolean not null default true,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.line_webhook_events (
  id uuid primary key default gen_random_uuid(),
  line_event_id text unique,
  event_type text not null,
  line_user_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index employees_auth_user_idx on public.employees(auth_user_id) where auth_user_id is not null;
create index employees_department_idx on public.employees(department_id) where is_active;
create index requests_requester_idx on public.requests(requester_id, created_at desc);
create index requests_status_idx on public.requests(status, updated_at desc);
create index requests_assignee_idx on public.requests(assignee_id, status) where assignee_id is not null;
create index approval_steps_lookup_idx on public.approval_steps(request_id, step_order, status);
create index notifications_recipient_idx on public.notifications(recipient_id, read_at, created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

-- Authorization helpers live outside the exposed public schema.
create or replace function private.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.auth_user_id = (select auth.uid()) and e.is_active
  limit 1
$$;

create or replace function private.has_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    join public.role_permissions rp on rp.role_id = e.role_id
    join public.permissions p on p.id = rp.permission_id
    where e.auth_user_id = (select auth.uid())
      and e.is_active
      and p.code = permission_code
  )
$$;

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
              )
            )
        )
        or private.has_permission('requests.view_all')
      )
  )
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.current_employee_id() to authenticated;
grant execute on function private.has_permission(text) to authenticated;
grant execute on function private.can_access_request(uuid) to authenticated;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.assign_request_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  type_prefix text;
begin
  select prefix into type_prefix from public.request_types where id = new.request_type_id;
  if type_prefix is null then raise exception 'Unknown request type'; end if;
  new.request_no := type_prefix || '-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.request_number_seq')::text, 6, '0');
  return new;
end;
$$;

create or replace function private.log_request_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    insert into public.request_status_history(request_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, coalesce(new.last_changed_by, private.current_employee_id()));

    insert into public.notifications(recipient_id, request_id, title, body, action_url)
    values (
      new.requester_id,
      new.id,
      'สถานะคำร้องมีการเปลี่ยนแปลง',
      new.request_no || ' เปลี่ยนเป็น ' || new.status::text,
      '/requests/' || new.id::text
    );
  end if;
  return new;
end;
$$;

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_id text;
begin
  row_id := coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'));
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    private.current_employee_id(),
    tg_op,
    tg_table_name,
    row_id,
    jsonb_build_object('old', case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
                       'new', case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end)
  );
  return coalesce(new, old);
end;
$$;

revoke all on function private.touch_updated_at() from public, anon, authenticated;
revoke all on function private.assign_request_number() from public, anon, authenticated;
revoke all on function private.log_request_status_change() from public, anon, authenticated;
revoke all on function private.audit_row_change() from public, anon, authenticated;

create trigger departments_touch before update on public.departments
for each row execute function private.touch_updated_at();
create trigger employees_touch before update on public.employees
for each row execute function private.touch_updated_at();
create trigger request_types_touch before update on public.request_types
for each row execute function private.touch_updated_at();
create trigger requests_touch before update on public.requests
for each row execute function private.touch_updated_at();
create trigger line_accounts_touch before update on public.line_accounts
for each row execute function private.touch_updated_at();
create trigger requests_number before insert on public.requests
for each row execute function private.assign_request_number();
create trigger requests_status_history after update of status on public.requests
for each row execute function private.log_request_status_change();

create trigger requests_audit after insert or update or delete on public.requests
for each row execute function private.audit_row_change();
create trigger approvals_audit after insert or update or delete on public.approval_steps
for each row execute function private.audit_row_change();
create trigger employees_audit after insert or update or delete on public.employees
for each row execute function private.audit_row_change();
create trigger line_accounts_audit after insert or update or delete on public.line_accounts
for each row execute function private.audit_row_change();

-- Explicit grants: new Supabase projects no longer expose new public tables automatically.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.departments, public.roles, public.permissions, public.request_types to authenticated;
grant select on public.employees to authenticated;
grant select on public.requests, public.approval_steps to authenticated;
grant select, insert on public.request_comments, public.request_attachments to authenticated;
grant select on public.request_status_history to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select on public.audit_logs, public.line_accounts to authenticated;

alter table public.departments enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.employees enable row level security;
alter table public.request_types enable row level security;
alter table public.requests enable row level security;
alter table public.approval_steps enable row level security;
alter table public.request_comments enable row level security;
alter table public.request_attachments enable row level security;
alter table public.request_status_history enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.line_accounts enable row level security;
alter table public.line_webhook_events enable row level security;

create policy departments_read on public.departments for select to authenticated using (is_active);
create policy roles_read on public.roles for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy employees_directory_read on public.employees for select to authenticated
using (is_active or auth_user_id = (select auth.uid()));
create policy request_types_read on public.request_types for select to authenticated using (is_active);

create policy requests_read on public.requests for select to authenticated
using (private.can_access_request(id));
create policy approval_steps_read on public.approval_steps for select to authenticated
using (private.can_access_request(request_id));

create policy comments_read on public.request_comments for select to authenticated
using (private.can_access_request(request_id));
create policy comments_create on public.request_comments for insert to authenticated
with check (author_id = private.current_employee_id() and private.can_access_request(request_id));
create policy attachments_read on public.request_attachments for select to authenticated
using (private.can_access_request(request_id));
create policy attachments_create on public.request_attachments for insert to authenticated
with check (uploader_id = private.current_employee_id() and private.can_access_request(request_id));
create policy history_read on public.request_status_history for select to authenticated
using (private.can_access_request(request_id));

create policy notifications_read on public.notifications for select to authenticated
using (recipient_id = private.current_employee_id());
create policy notifications_mark_read on public.notifications for update to authenticated
using (recipient_id = private.current_employee_id())
with check (recipient_id = private.current_employee_id());
create policy audit_read on public.audit_logs for select to authenticated
using (private.has_permission('audit.view'));
create policy line_accounts_read on public.line_accounts for select to authenticated
using (employee_id = private.current_employee_id() or private.has_permission('employees.manage'));

-- Private attachment bucket. Objects are always accessed through authenticated requests or signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'request-attachments',
  'request-attachments',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf','text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy request_files_read on storage.objects for select to authenticated
using (
  bucket_id = 'request-attachments'
  and private.can_access_request(((storage.foldername(name))[1])::uuid)
);
create policy request_files_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'request-attachments'
  and owner_id = (select auth.uid())::text
  and private.can_access_request(((storage.foldername(name))[1])::uuid)
);

-- Reference data
insert into public.departments (id, code, name_th, name_en) values
  ('10000000-0000-0000-0000-000000000001','MGT','ฝ่ายบริหาร','Management'),
  ('10000000-0000-0000-0000-000000000002','MT','ฝ่ายซ่อมบำรุง','Maintenance'),
  ('10000000-0000-0000-0000-000000000003','IT','ฝ่ายเทคโนโลยีสารสนเทศ','Information Technology'),
  ('10000000-0000-0000-0000-000000000004','HR','ฝ่ายทรัพยากรบุคคล','Human Resources'),
  ('10000000-0000-0000-0000-000000000005','PUR','ฝ่ายจัดซื้อ','Purchasing'),
  ('10000000-0000-0000-0000-000000000006','FIN','ฝ่ายการเงิน','Finance'),
  ('10000000-0000-0000-0000-000000000007','OPS','ฝ่ายปฏิบัติการ','Operations');

insert into public.roles (id, code, name_th, description) values
  ('20000000-0000-0000-0000-000000000001','employee','พนักงาน','สร้างและติดตามคำร้องของตนเอง'),
  ('20000000-0000-0000-0000-000000000002','approver','ผู้อนุมัติ','อนุมัติคำร้องตามหน่วยงาน'),
  ('20000000-0000-0000-0000-000000000003','operator','ผู้ปฏิบัติงาน','รับและดำเนินงานตามคำร้อง'),
  ('20000000-0000-0000-0000-000000000004','admin','ผู้ดูแลระบบ','จัดการข้อมูลหลัก สิทธิ์ และตรวจสอบระบบ');

insert into public.permissions (id, code, description) values
  ('30000000-0000-0000-0000-000000000001','requests.create','Create requests'),
  ('30000000-0000-0000-0000-000000000002','requests.view_all','View every request'),
  ('30000000-0000-0000-0000-000000000003','approvals.act','Approve, reject or request more information'),
  ('30000000-0000-0000-0000-000000000004','requests.operate','Assign and update operational status'),
  ('30000000-0000-0000-0000-000000000005','employees.manage','Manage employees and LINE links'),
  ('30000000-0000-0000-0000-000000000006','audit.view','View audit trail');

insert into public.role_permissions (role_id, permission_id)
select '20000000-0000-0000-0000-000000000001', id from public.permissions where code = 'requests.create';
insert into public.role_permissions (role_id, permission_id)
select '20000000-0000-0000-0000-000000000002', id from public.permissions where code in ('requests.create','approvals.act');
insert into public.role_permissions (role_id, permission_id)
select '20000000-0000-0000-0000-000000000003', id from public.permissions where code in ('requests.create','requests.operate');
insert into public.role_permissions (role_id, permission_id)
select '20000000-0000-0000-0000-000000000004', id from public.permissions;

insert into public.request_types
  (id, code, prefix, name_th, name_en, description, icon, owning_department_id, final_approver_role_id, requires_manager_approval, sort_order, form_schema)
values
  ('40000000-0000-0000-0000-000000000001','MT_REPAIR','MT','แจ้งซ่อมเครื่องจักร/อาคาร','Maintenance repair','แจ้งปัญหาเครื่องจักร ระบบสาธารณูปโภค หรืออาคาร','wrench','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',true,10,'{"fields":["asset_code","location","preferred_date"]}'),
  ('40000000-0000-0000-0000-000000000002','IT_REPAIR','IT','แจ้งซ่อม IT','IT repair','คอมพิวเตอร์ อุปกรณ์ ระบบ หรือซอฟต์แวร์','monitor-cog','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002',true,20,'{"fields":["asset_code","location","impact"]}'),
  ('40000000-0000-0000-0000-000000000003','VEHICLE_REPAIR','VH','แจ้งซ่อมรถ','Vehicle repair','แจ้งตรวจเช็กหรือซ่อมรถบริษัท','car','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',true,30,'{"fields":["vehicle_no","odometer","preferred_date"]}'),
  ('40000000-0000-0000-0000-000000000004','PURCHASE','PR','ขอซื้อ / ขอซ่อม','Purchase request','ขอซื้อสินค้า บริการ หรือส่งซ่อมภายนอก','shopping-cart','10000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002',true,40,'{"fields":["estimated_cost","required_date","vendor"]}'),
  ('40000000-0000-0000-0000-000000000005','MANAGEMENT','MG','คำร้องฝ่ายบริหาร','Management request','คำร้องทั่วไปที่ต้องการการพิจารณาจากฝ่ายบริหาร','building-2','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',true,50,'{"fields":["required_date","business_reason"]}'),
  ('40000000-0000-0000-0000-000000000006','IT_ACCESS','IA','ขอสิทธิ์เข้าถึงระบบ','IT access request','เพิ่ม เปลี่ยน หรือยกเลิกสิทธิ์ระบบ','key-round','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002',true,60,'{"fields":["system_name","access_level","required_date"]}'),
  ('40000000-0000-0000-0000-000000000007','HR_LEAVE','LV','ขอลางาน','Leave request','บันทึกคำขอลาและเหตุผล','calendar-days','10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002',true,70,'{"fields":["leave_type","start_date","end_date"]}'),
  ('40000000-0000-0000-0000-000000000008','HR_TRAINING','TR','ขออบรม','Training request','ขออนุมัติเข้าร่วมการอบรม','graduation-cap','10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002',true,80,'{"fields":["course_name","provider","estimated_cost","start_date","end_date"]}');
