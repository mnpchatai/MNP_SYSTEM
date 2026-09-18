-- Keep historical request types for existing records, but expose only the
-- three modules currently approved for new requests.
update public.request_types
set is_active = false
where code not in ('MT_REPAIR', 'MANAGEMENT', 'NCR_CAR');

update public.request_types
set
  name_th = 'ใบคำร้อง/แจ้งซ่อม MT',
  name_en = 'MT request / repair',
  description = 'ใบคำร้องหรือใบแจ้งซ่อมสำหรับงาน MT',
  is_active = true,
  sort_order = 10
where code = 'MT_REPAIR';

update public.request_types
set
  name_th = 'ใบคำร้องถึงห้องบริหาร',
  name_en = 'Management office request',
  description = 'ใบคำร้องที่ต้องการส่งถึงห้องบริหาร',
  is_active = true,
  sort_order = 20
where code = 'MANAGEMENT';

insert into public.request_types (
  code,
  prefix,
  name_th,
  name_en,
  description,
  icon,
  owning_department_id,
  final_approver_role_id,
  requires_manager_approval,
  form_schema,
  is_active,
  sort_order,
  uses_repair_workflow
)
values (
  'NCR_CAR',
  'NC',
  'NCR/CAR',
  'NCR / CAR',
  'รายงานความไม่สอดคล้องและการดำเนินการแก้ไข/ป้องกัน',
  'clipboard-check',
  (select id from public.departments where code = 'QA' limit 1),
  (select id from public.roles where code = 'approver' limit 1),
  true,
  '{"fields":[]}'::jsonb,
  true,
  30,
  false
)
on conflict (code) do update
set
  prefix = excluded.prefix,
  name_th = excluded.name_th,
  name_en = excluded.name_en,
  description = excluded.description,
  icon = excluded.icon,
  owning_department_id = excluded.owning_department_id,
  final_approver_role_id = excluded.final_approver_role_id,
  requires_manager_approval = excluded.requires_manager_approval,
  form_schema = excluded.form_schema,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  uses_repair_workflow = excluded.uses_repair_workflow;
