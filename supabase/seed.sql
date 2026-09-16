-- Demo business data. These records do not create Supabase Auth users.
-- After inviting a real Auth user, set employees.auth_user_id to the user's UUID.

insert into public.employees
  (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, manager_id)
values
  ('50000000-0000-0000-0000-000000000001','MNP0001','อรทัย','ผู้ดูแล','admin@mnp.local','System Administrator','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004',null),
  ('50000000-0000-0000-0000-000000000002','MNP0101','สมชาย','หัวหน้างาน','approver@mnp.local','Operations Manager','10000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000002',null),
  ('50000000-0000-0000-0000-000000000003','MNP0102','สายฝน','พนักงาน','employee@mnp.local','Operations Officer','10000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002'),
  ('50000000-0000-0000-0000-000000000004','MNP0201','อนันต์','ช่างซ่อม','maintenance@mnp.local','Maintenance Technician','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003',null)
on conflict (id) do nothing;

insert into public.requests
  (id, request_no, request_type_id, requester_id, department_id, title, description, details, priority, status, assignee_id)
values
  ('60000000-0000-0000-0000-000000000001','seed-placeholder','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000007','สายพานลำเลียงมีเสียงผิดปกติ','พบเสียงดังบริเวณลูกปืนด้านขับระหว่างเดินเครื่อง','{"asset_code":"CV-012","location":"อาคารผลิต A"}','high','in_progress','50000000-0000-0000-0000-000000000004'),
  ('60000000-0000-0000-0000-000000000002','seed-placeholder-2','40000000-0000-0000-0000-000000000006','50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000007','ขอสิทธิ์ระบบรายงาน BI','ต้องการสิทธิ์อ่าน dashboard ประจำฝ่ายปฏิบัติการ','{"system_name":"Power BI","access_level":"Viewer"}','normal','pending_approval',null)
on conflict (id) do nothing;

insert into public.approval_steps
  (request_id, step_order, step_name, approver_employee_id, status)
values
  ('60000000-0000-0000-0000-000000000001',1,'หัวหน้าแผนก','50000000-0000-0000-0000-000000000002','approved'),
  ('60000000-0000-0000-0000-000000000002',1,'หัวหน้าแผนก','50000000-0000-0000-0000-000000000002','pending')
on conflict (request_id, step_order) do nothing;

insert into public.request_status_history(request_id, from_status, to_status, changed_by, note)
values
  ('60000000-0000-0000-0000-000000000001',null,'in_progress','50000000-0000-0000-0000-000000000004','Demo request'),
  ('60000000-0000-0000-0000-000000000002',null,'pending_approval','50000000-0000-0000-0000-000000000003','Demo request');

