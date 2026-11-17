-- ใบสั่งผลิตปิดได้เมื่อทุกงานผลิตเสร็จ · WH ปิดใบที่รับครบเอง (closeOrder) · ฝ่ายวางแผนปิดงานพร้อมเหตุผล (20261125010000_bom_close_rules.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: รายการ action · สิทธิ์ของฟังก์ชันที่ replace · รูปคำขอ closeOrder (BOM_INVALID_FG) · สิทธิ์ (WH / admin ได้ กลุ่มวางแผน PK ผู้จัดการแผนกอื่นไม่ได้)
-- รับครบขณะที่งาน RB / GR ยังเปิด = ใบเปิดต่อ · closeOrder / closeOrderShort ถูกปฏิเสธจนทุกงานผลิต done · งานเบิกของซื้อ (ST / PURCHASED) ที่ยังเปิดไม่กันการปิด
-- ฝ่ายวางแผนปิดงานด้วยรายการรายงานยอด 0 + เหตุผล (setJobStatus): พนักงานแผนก action อื่น เหตุผลสั้น ยอดเปลี่ยน สถานะไม่ใช่ done งานของซื้อ งานที่ done แล้ว ถูกปฏิเสธ
-- ปิดเองตอนรับยังมีเมื่อทุกงานผลิตเสร็จก่อน · จำนวนใน audit · ข้อความคงที่ของแถว close
-- authenticated อ่านตาราง bom_* ตรงไม่ได้ จึงอ่านผ่าน RPC และอ่านตารางด้วย reset role เท่านั้น
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. รายการ action และสิทธิ์ของฟังก์ชันที่ replace ------------------------------------------------------------
select ok('closeOrder' = any (private.bom_client_actions()) and 'closeOrder' = any (private.bom_staff_actions()),
  'closeOrder is on the client and the staff whitelists');
select ok(array['receiveFg', 'deliverFg', 'closeOrderShort', 'reportJob', 'setJobStatus', 'issueOrderParts', 'countPartStock'] <@ private.bom_client_actions()
          and array['receiveFg', 'deliverFg', 'closeOrderShort', 'reportJob', 'setJobStatus', 'issueOrderParts', 'countPartStock'] <@ private.bom_staff_actions()
          and not ('completeOrder' = any (private.bom_client_actions())),
  'the earlier actions stay on the lists and completeOrder stays off');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_fg_move(public.employees,text,jsonb)'::regprocedure,
                           'private.bom_save_jobs(public.employees,text,boolean,text,jsonb,uuid[],bigint,bigint)'::regprocedure,
                           'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the replaced writers and the RPC are security definer with an empty search_path');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_client_actions()'::regprocedure, 'private.bom_staff_actions()'::regprocedure)),
  'the replaced action lists have an empty search_path');
select ok(not exists (
    select 1 from unnest(array['private.bom_fg_move(public.employees,text,jsonb)', 'private.bom_save_jobs(public.employees,text,boolean,text,jsonb,uuid[],bigint,bigint)',
                               'private.bom_client_actions()', 'private.bom_staff_actions()']) f(sig)
    where has_function_privilege('anon', f.sig, 'execute') or has_function_privilege('authenticated', f.sig, 'execute')),
  'clients cannot call the replaced private functions directly');
select ok(not has_function_privilege('anon', 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'execute')
          and has_function_privilege('authenticated', 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'execute'),
  'the save RPC keeps its grants (signed-in users only)');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');

-- 2. บัญชีทดสอบ ------------------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8e500000-0000-0000-0000-000000000001', 'bomclose-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8e500000-0000-0000-0000-000000000101', 'BOMCLOSE-ADMIN', 'Bomclose', 'Admin', 'bomclose-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8e500000-0000-0000-0000-000000000001');
-- persona (is_test) เพิ่ม: ผู้ดูแลระบบ (ไม่มี persona บทบาท admin ในชุดตั้งต้น)
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test) values
  ('SBX-ADMIN-T', 'ทดสอบ', 'ผู้ดูแลระบบ', 'sbx-admin-close-t@sandbox.local', 'ผู้ดูแลระบบ (ทดสอบ)',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select ok((select count(*) from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.is_test and ((e.employee_no = 'SBX-WH-STAFF' and d.code = 'WH') or (e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP')
                                or (e.employee_no = 'SBX-PK-STAFF' and d.code = 'PK') or (e.employee_no = 'SBX-RB-STAFF' and d.code = 'RB')
                                or (e.employee_no = 'SBX-GR-STAFF' and d.code = 'GR') or (e.employee_no = 'SBX-ST-STAFF' and d.code = 'ST')
                                or (e.employee_no = 'SBX-RB-MGR' and d.code = 'RB' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-ADMIN-T' and r.code = 'admin'))) = 8,
  'the personas used below belong to the departments and roles the rules name');

-- ตัวช่วยของเทสต์ (schema แยก ลบพร้อม rollback): รันในฐานะผู้เรียก (authenticated) ผ่าน RPC สาธารณะเท่านั้น
create schema cr_t;
grant usage on schema cr_t to authenticated;
create function cr_t.ver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function cr_t.save(p_changes jsonb, p_action text, p_base bigint default null) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, coalesce(p_base, cr_t.ver()), p_action)
$$;
create function cr_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
create function cr_t.order_status(p_no text) returns text language sql stable as $$ select cr_t.order_row(p_no) ->> 'status' $$;
create function cr_t.up_order(p_res jsonb, p_no text) returns jsonb language sql immutable as $$
  select o from jsonb_array_elements(p_res -> 'changes' -> 'orders' -> 'upsert') o where o ->> 'id' = p_no
$$;
create function cr_t.job(p_no text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_no
$$;
-- รายงานผลงานหนึ่งงาน: เพิ่มยอดดีพร้อมรายการรายงานต่อท้าย และตั้งสถานะ
create function cr_t.report(p_no text, p_good numeric, p_status text) returns jsonb language sql volatile as $$
  select cr_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
    cr_t.job(p_no) || jsonb_build_object('status', p_status, 'qtyDone', (cr_t.job(p_no) ->> 'qtyDone')::numeric + p_good,
      'reports', (cr_t.job(p_no) -> 'reports') || jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', p_good, 'reject', 0, 'note', '')))))), 'reportJob')
$$;
-- ปิดงาน: สถานะ (ปกติ done) + รายการรายงานยอด 0 ที่มีเหตุผล · p_extra แก้ช่องอื่นของงานในแถวเดียวกัน (ใช้ทดสอบฝั่งปฏิเสธ)
create function cr_t.close_job(p_no text, p_note text, p_action text default 'setJobStatus', p_status text default 'done', p_extra jsonb default '{}'::jsonb)
returns jsonb language sql volatile as $$
  select cr_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
    cr_t.job(p_no) || jsonb_build_object('status', p_status,
      'reports', (cr_t.job(p_no) -> 'reports') || jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 0, 'reject', 0, 'note', p_note))) || p_extra))), p_action)
$$;
create function cr_t.fg(p_row jsonb, p_action text) returns jsonb language sql volatile as $$
  select cr_t.save(jsonb_build_object('fgMoves', jsonb_build_object('upsert', jsonb_build_array(p_row))), p_action)
$$;
create function cr_t.receive(p_order text, p_qty numeric) returns jsonb language sql volatile as $$
  select cr_t.fg(jsonb_build_object('orderId', p_order, 'kind', 'receive', 'lines', jsonb_build_array(jsonb_build_object('fgCode', 'FG-A', 'qty', p_qty))), 'receiveFg')
$$;
create function cr_t.close(p_order text) returns jsonb language sql volatile as $$
  select cr_t.fg(jsonb_build_object('orderId', p_order, 'kind', 'close'), 'closeOrder')
$$;
create function cr_t.close_short(p_order text, p_note text) returns jsonb language sql volatile as $$
  select cr_t.fg(jsonb_build_object('orderId', p_order, 'kind', 'close', 'note', p_note), 'closeOrderShort')
$$;
create function cr_t.moves(p_order text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(t.m order by t.ord), '[]'::jsonb)
  from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') with ordinality as t(m, ord) where t.m ->> 'orderId' = p_order
$$;

select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"PK":1764000000000},"dueDefaults":[],"revision":0,"status":"draft","items":[],"explosion":null,"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"PK","itemCode":"FG-A","name":"งานทดสอบ","kind":"FG","uom":"set","qtyPlanned":5,"qtyRequired":5,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["FG-A"],"reports":[]}', true);

-- 3. ข้อมูลตั้งต้น: ใบ PI 6 ใบ ------------------------------------------------------------------------------
--   25001 FG-A 5: งาน RB GR PK และเบิกของซื้อ (ST) · รับครบขณะที่ RB / GR ยังเปิด
--   25002 FG-A 4: งาน RB PK · PK ทำได้ 3 ปิดรับไม่ครบหลังฝ่ายวางแผนปิดงาน RB
--   25003 FG-A 2: งาน PK และเบิกของซื้อที่ยังไม่เบิก · ปิดเองตอนรับครบ (งานของซื้อไม่นับ)
--   25004 FG-A 3: งาน RB PK ที่เสร็จก่อนรับ · ปิดเองตอนรับครบ
--   25005 FG-A 1: งาน GR PK · ผู้ดูแลระบบปิดใบหลังฝ่ายวางแผนปิดงาน GR
--   25006 FG-A 1: ใบร่าง
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8e500000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_save_master('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"SE-A","kind":"SE","name":"ชิ้นยาง A","ownerDept":"GR","uom":"pcs"},
  {"code":"RB-A","kind":"RB","name":"เส้นยาง A","ownerDept":"RB","uom":"pcs"},
  {"code":"P-1","kind":"PURCHASED","name":"กล่อง","ownerDept":"ST","uom":"box"}]}}'::jsonb, 0, 'importFlat') ->> 'version', '1', 'the planner seeds the items');
select ok(cr_t.save(jsonb_build_object(
  'customers', jsonb_build_object('upsert', jsonb_build_array('{"name":"ACME","country":"TH","orderType":"SA","note":""}'::jsonb)),
  'orders', jsonb_build_object('upsert', (select jsonb_agg(current_setting('test.ord')::jsonb || jsonb_build_object('id', t.no,
      'items', jsonb_build_array(jsonb_build_object('fgCode', 'FG-A', 'qty', t.qty, 'colorSet', 'A', 'note', '')),
      'explosion', jsonb_build_array(jsonb_build_object('itemCode', 'FG-A', 'level', 0, 'fgQty', t.qty, 'required', t.qty))) order by t.no)
    from (values ('251125-25001', 5), ('251125-25002', 4), ('251125-25003', 2), ('251125-25004', 3), ('251125-25005', 1), ('251125-25006', 1)) t(no, qty)))), 'createOrder') is not null,
  'the planner creates six draft orders');
select ok(cr_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', (select jsonb_agg(cr_t.order_row(n) || '{"status":"released"}'::jsonb)
                                          from unnest(array['251125-25001', '251125-25002', '251125-25003', '251125-25004', '251125-25005']) n)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-1-RB","orderId":"251125-25001","dept":"RB","itemCode":"RB-A","kind":"RB","uom":"pcs"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-1-GR","orderId":"251125-25001","dept":"GR","itemCode":"SE-A","kind":"SE","uom":"pcs"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-1-PK","orderId":"251125-25001"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-1-P1","orderId":"251125-25001","dept":"ST","itemCode":"P-1","kind":"PURCHASED","uom":"box"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-2-RB","orderId":"251125-25002","dept":"RB","itemCode":"RB-A","kind":"RB","uom":"pcs","qtyPlanned":4,"qtyRequired":4}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-2-PK","orderId":"251125-25002","qtyPlanned":4,"qtyRequired":4}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-3-PK","orderId":"251125-25003","qtyPlanned":2,"qtyRequired":2}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-3-P1","orderId":"251125-25003","dept":"ST","itemCode":"P-1","kind":"PURCHASED","uom":"box","qtyPlanned":2,"qtyRequired":2}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-4-RB","orderId":"251125-25004","dept":"RB","itemCode":"RB-A","kind":"RB","uom":"pcs","qtyPlanned":3,"qtyRequired":3}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-4-PK","orderId":"251125-25004","qtyPlanned":3,"qtyRequired":3}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-5-GR","orderId":"251125-25005","dept":"GR","itemCode":"SE-A","kind":"SE","uom":"pcs","qtyPlanned":1,"qtyRequired":1}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-5-PK","orderId":"251125-25005","qtyPlanned":1,"qtyRequired":1}'::jsonb))), 'releaseOrder') is not null,
  'the planner releases five orders with their jobs');
select is((select jsonb_agg(cr_t.order_status(n) order by n) from unnest(array['251125-25001', '251125-25006']) n), '["released","draft"]'::jsonb,
  'the orders are released and one stays a draft');

-- 4. ใบ 25001: PK ทำครบ WH รับครบ ขณะที่งาน RB / GR ยังเปิด = ใบเปิดต่อ -------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select ok(cr_t.report('JOB-1-PK', 5, 'done') is not null, 'PK packs all 5 sets of 25001');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select set_config('test.v0', cr_t.ver()::text, true);
select set_config('test.res', cr_t.receive('251125-25001', 5)::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert', '[]'::jsonb,
  'everything ordered is received while RB and GR are open: the order is not closed');
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert'), 1, 'the receipt itself is written');
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.v0')::bigint + 1)::text, 'the version moved once');
select is(cr_t.order_status('251125-25001'), 'in_progress', 'the order stays in progress');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'receiveFg' and a ->> 'detail' = 'fgMoves +1'),
  'the receipt is audited without an order');

-- 5. closeOrder: รูปคำขอ (WH ผ่านด่านสิทธิ์จึงเห็นข้อผิดรูป) · ทุกกรณีไม่เขียนอะไร ------------------------------------------
select set_config('test.v1', cr_t.ver()::text, true);
select throws_ok($$ select cr_t.save('{}'::jsonb, 'closeOrder') $$, 'BOM_INVALID_FG', 'a close without the fgMoves section is refused');
select throws_ok($$ select cr_t.save('{"fgMoves":{"upsert":[]}}'::jsonb, 'closeOrder') $$, 'BOM_INVALID_FG', 'a close with an empty request list is refused');
select throws_ok($$ select cr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(cr_t.order_row('251125-25001')))), 'closeOrder') $$, 'BOM_INVALID_FG',
  'the close action cannot carry an order row');
select throws_ok($$ select cr_t.save(jsonb_build_object('fgMoves', jsonb_build_object('upsert', jsonb_build_array('{"orderId":"251125-25001","kind":"close"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(cr_t.job('JOB-1-GR')))), 'closeOrder') $$, 'BOM_INVALID_FG', 'nor a request together with a job row');
select throws_ok($$ select cr_t.save('{"fgMoves":{"upsert":[{"orderId":"251125-25001","kind":"close"}]}}'::jsonb, 'reportJob') $$, 'BOM_INVALID_FG',
  'a close request cannot be sent with another action');
select throws_ok($$ select cr_t.fg('{"orderId":"251125-25001","kind":"receive","lines":[{"fgCode":"FG-A","qty":1}]}'::jsonb, 'closeOrder') $$, 'BOM_INVALID_FG',
  'the kind must be close');
select throws_ok($$ select cr_t.fg('{"orderId":"251125-25001"}'::jsonb, 'closeOrder') $$, 'BOM_INVALID_FG', 'the kind is required');
select throws_ok($$ select cr_t.fg('{"kind":"close"}'::jsonb, 'closeOrder') $$, 'BOM_INVALID_FG', 'the order is required');
select throws_ok($$ select cr_t.fg('{"orderId":"251125-25001","kind":"close","lines":[{"fgCode":"FG-A","qty":1}]}'::jsonb, 'closeOrder') $$, 'BOM_INVALID_FG',
  'a close request has no lines');
select throws_ok($$ select cr_t.fg('{"orderId":"251125-25001","kind":"close","note":"ปิดใบเอง"}'::jsonb, 'closeOrder') $$, 'BOM_INVALID_FG',
  'a full close takes no reason from the client (the server writes the note)');
select throws_ok($$ select cr_t.fg('{"orderId":"251125-25001","kind":"close","note":1}'::jsonb, 'closeOrder') $$, 'BOM_INVALID_FG', 'a note that is not text is refused');
select throws_ok($$ select cr_t.save('{"fgMoves":{"upsert":[{"orderId":"251125-25001","kind":"close"},{"orderId":"251125-25001","kind":"close"}]}}'::jsonb, 'closeOrder') $$,
  'BOM_INVALID_FG', 'one request per call');
select throws_ok($$ select cr_t.close('251125-NOPE') $$, 'BOM_INVALID_FG', 'an unknown order is refused');
select throws_ok($$ select cr_t.fg('{"orderId":"251125-25004","kind":"close","note":"   ","lines":[]}'::jsonb, 'closeOrder') $$, 'BOM_INVALID_TRANSITION',
  'empty lines and a blank note pass the shape check (the order is then refused for its open jobs)');
select is(cr_t.ver(), current_setting('test.v1')::bigint, 'none of the refused requests moved the version');

-- 6. closeOrder: สิทธิ์ (ก่อนสถานะ) และสถานะ / งานผลิตที่ยังเปิด ----------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select throws_ok($$ select cr_t.fg('{"orderId":"251125-25001","kind":"close","note":"x"}'::jsonb, 'closeOrder') $$, 'BOM_INVALID_FG', 'the shape is checked before the permission');
select throws_ok($$ select cr_t.close('251125-25001') $$, 'BOM_FORBIDDEN', 'PK staff cannot close an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select cr_t.close('251125-25001') $$, 'BOM_FORBIDDEN', 'the planning group cannot close an order (the planner flag is not WH)');
select throws_ok($$ select cr_t.close('251125-NOPE') $$, 'BOM_FORBIDDEN', 'the permission is checked before the order is looked up');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select cr_t.close('251125-25001') $$, 'BOM_FORBIDDEN', 'a department manager of RB cannot close an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select cr_t.close('251125-25001') $$, 'BOM_FORBIDDEN', 'ST staff cannot close an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select cr_t.close('251125-25006') $$, 'BOM_INVALID_TRANSITION', 'a draft cannot be closed');
select throws_ok($$ select cr_t.close('251125-25001') $$, 'BOM_INVALID_TRANSITION', 'WH cannot close 25001 while RB and GR are open');
select throws_ok($$ select cr_t.close_short('251125-25001', 'ปิดก่อนงานเสร็จ') $$, 'BOM_INVALID_TRANSITION', 'nor close it short (nothing is short, and RB and GR are open)');
select throws_ok($$ select cr_t.close('251125-25002') $$, 'BOM_INVALID_TRANSITION', 'an order that is not fully received cannot be closed in full');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select ok(cr_t.report('JOB-1-RB', 5, 'done') is not null, 'RB finishes its job of 25001');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select cr_t.close('251125-25001') $$, 'BOM_INVALID_TRANSITION', 'GR is still open: still refused');
select is(cr_t.ver(), current_setting('test.v1')::bigint + 1, 'only the RB report moved the version');

-- 7. ฝ่ายวางแผนปิดงานพร้อมเหตุผล: ฝั่งปฏิเสธ ------------------------------------------------------------------------------
select set_config('test.v2', cr_t.ver()::text, true);
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select cr_t.close_job('JOB-1-GR', 'ไม่ทำต่อแล้ว') $$, 'BOM_INVALID_JOB', 'a GR member cannot close the GR job with a zero report');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select cr_t.close_job('JOB-1-GR', 'ไม่ทำต่อแล้ว') $$, 'BOM_INVALID_JOB', 'nor can WH (a zero report from outside the planning group is refused first)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select cr_t.close_job('JOB-1-GR', '') $$, 'BOM_INVALID_JOB', 'a planner needs a reason');
select throws_ok($$ select cr_t.close_job('JOB-1-GR', '  ab  ') $$, 'BOM_INVALID_JOB', 'of at least three characters after trimming');
select throws_ok($$ select cr_t.close_job('JOB-1-GR', repeat('ก', 201)) $$, 'BOM_INVALID_JOB', 'and at most 200');
select throws_ok($$ select cr_t.close_job('JOB-1-GR', 'ไม่ทำต่อแล้ว', 'reportJob') $$, 'BOM_INVALID_JOB', 'a zero report under another action is refused');
select throws_ok($$ select cr_t.close_job('JOB-1-GR', 'ไม่ทำต่อแล้ว', 'setJobStatus', 'hold') $$, 'BOM_INVALID_JOB', 'a zero report that does not finish the job is refused');
select throws_ok($$ select cr_t.close_job('JOB-1-GR', 'ไม่ทำต่อแล้ว', 'setJobStatus', 'done', '{"qtyDone":2}'::jsonb) $$, 'BOM_INVALID_JOB',
  'closing a job does not add output');
select throws_ok($$ select cr_t.close_job('JOB-1-GR', 'ไม่ทำต่อแล้ว', 'setJobStatus', 'done', '{"qtyReject":1}'::jsonb) $$, 'BOM_INVALID_JOB',
  'nor rejects');
select throws_ok($$ select cr_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  cr_t.job('JOB-1-GR') || jsonb_build_object('status', 'done', 'reports', jsonb_build_array(
    '{"at":1,"by":"x","good":0,"reject":0,"note":"ไม่ทำต่อ"}'::jsonb, '{"at":1,"by":"x","good":0,"reject":0,"note":"ไม่ทำต่อ"}'::jsonb))))), 'setJobStatus') $$,
  'BOM_INVALID_JOB', 'only one closing entry can be added');
select throws_ok($$ select cr_t.close_job('JOB-1-P1', 'ไม่ต้องเบิกแล้ว') $$, 'BOM_INVALID_TRANSITION',
  'a purchased-part line is not closed this way (it is issued by ST)');
select throws_ok($$ select cr_t.close_job('JOB-1-PK', 'ปิดซ้ำ') $$, 'BOM_INVALID_JOB', 'a job that is done already takes no closing entry');
select is(cr_t.ver(), current_setting('test.v2')::bigint, 'none of the refused closes moved the version');

-- 8. ฝ่ายวางแผนปิดงาน GR แล้ว WH ปิดใบ ------------------------------------------------------------------------------------
select set_config('test.res', cr_t.close_job('JOB-1-GR', '  ใช้ชิ้นยางค้างไลน์แทน ไม่ตัดเพิ่ม  ')::text, true);
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.v2')::bigint + 1)::text, 'the planner closes the GR job in one save');
select is(cr_t.job('JOB-1-GR') ->> 'status', 'done', 'the GR job is done');
select ok(cr_t.job('JOB-1-GR') ? 'doneAt', 'with a finish time');
select is((cr_t.job('JOB-1-GR') ->> 'qtyDone')::numeric, 0::numeric, 'and no output added');
select is(jsonb_array_length(cr_t.job('JOB-1-GR') -> 'reports'), 1, 'one report entry was appended');
select is((cr_t.job('JOB-1-GR') -> 'reports' -> 0) - 'at', jsonb_build_object('by', current_setting('test.n_sbx_pp_staff'), 'good', 0, 'reject', 0, 'note', 'ใช้ชิ้นยางค้างไลน์แทน ไม่ตัดเพิ่ม'),
  'the entry carries the trimmed reason, zero quantities and the planner as its author');
select ok((cr_t.job('JOB-1-GR') -> 'reports' -> 0 ->> 'at')::bigint > 1700000000000, 'and the server time');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'setJobStatus' and a ->> 'detail' = 'jobs +1'
                  and a ->> 'user' = current_setting('test.n_sbx_pp_staff')),
  'the close is in the audit trail as a status change of one job');
select throws_ok($$ select cr_t.close('251125-25001') $$, 'BOM_FORBIDDEN', 'the planner still cannot close the order');
select throws_ok($$ select cr_t.close_job('JOB-1-GR', 'ปิดซ้ำอีกครั้ง') $$, 'BOM_INVALID_JOB', 'a closed job cannot be closed again');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select cr_t.close_short('251125-25001', 'ปิดรับไม่ครบ') $$, 'BOM_INVALID_TRANSITION', 'the order is not short, so a short close is refused');
select is(cr_t.job('JOB-1-P1') ->> 'status', 'queued', 'the purchased-part line is still waiting for an issue');
select set_config('test.v3', cr_t.ver()::text, true);
select set_config('test.res', cr_t.close('251125-25001')::text, true);
select is(cr_t.up_order(current_setting('test.res')::jsonb, '251125-25001') ->> 'status', 'completed',
  'with every production job done WH closes the order (the open purchased-part line does not block it)');
select ok(cr_t.up_order(current_setting('test.res')::jsonb, '251125-25001') ? 'completedAt', 'with the completion time');
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.v3')::bigint + 1)::text, 'the version moved once');
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert'), 1, 'one close move is written');
select is((current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0) - 'id' - 'at',
  jsonb_build_object('orderId', '251125-25001', 'fgCode', '', 'kind', 'close', 'qty', 0, 'note', 'รับครบ ปิดใบโดยคลังสินค้า', 'by', current_setting('test.n_sbx_wh_staff')),
  'the close move has no product, no quantity and the fixed note of the server');
select throws_ok($$ select cr_t.close('251125-25001') $$, 'BOM_INVALID_TRANSITION', 'a closed order is not closed again');
select throws_ok($$ select cr_t.close_job('JOB-1-P1', 'ไม่ต้องเบิกแล้ว') $$, 'BOM_INVALID_JOB', 'WH cannot add a zero report to the purchased line either');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'closeOrder' and a ->> 'detail' = 'fgMoves +1, orders +1'),
  'the full close is audited with the move and the order');

-- 9. ใบ 25003: งานเบิกของซื้อที่ยังไม่เบิกไม่กันการปิดเองตอนรับครบ · ใบ 25004: ทุกงานผลิตเสร็จก่อนรับ = ปิดเอง ---------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select ok(cr_t.report('JOB-3-PK', 2, 'done') is not null, 'PK packs the 2 sets of 25003');
select ok(cr_t.report('JOB-4-PK', 3, 'done') is not null, 'and the 3 sets of 25004');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select ok(cr_t.report('JOB-4-RB', 3, 'done') is not null, 'RB finishes its job of 25004');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select is(cr_t.up_order(cr_t.receive('251125-25003', 2), '251125-25003') ->> 'status', 'completed',
  'receiving everything closes 25003 at once: its only open job is a purchased-part line');
select is(cr_t.job('JOB-3-P1') ->> 'status', 'queued', 'the purchased-part line is untouched');
select ok(cr_t.receive('251125-25004', 2) is not null, 'WH receives 2 of the 3 sets of 25004');
select is(cr_t.order_status('251125-25004'), 'in_progress', 'not everything is received yet');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select is(cr_t.up_order(cr_t.receive('251125-25004', 1), '251125-25004') ->> 'status', 'completed',
  'an admin receives the last set and the order closes by itself (every production job was done)');

-- 10. ใบ 25002: ปิดรับไม่ครบต้องรอทุกงานผลิต (ไม่ใช่แค่ PK) --------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select ok(cr_t.report('JOB-2-PK', 3, 'done') is not null, 'PK finishes with 3 of the 4 ordered');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select ok(cr_t.receive('251125-25002', 3) is not null, 'WH receives the 3 sets');
select throws_ok($$ select cr_t.close_short('251125-25002', 'PK ทำได้ไม่ครบ') $$, 'BOM_INVALID_TRANSITION',
  'every PK job is done and everything PK made is received, but the RB job is open: the short close is refused');
select throws_ok($$ select cr_t.close('251125-25002') $$, 'BOM_INVALID_TRANSITION', 'a full close is refused too (one set is missing)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(cr_t.close_job('JOB-2-RB', 'เส้นยางพอจากรอบก่อน') is not null, 'the planner closes the RB job that will never be reported');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select cr_t.close('251125-25002') $$, 'BOM_INVALID_TRANSITION', 'a full close stays refused while something is short');
select is(cr_t.up_order(cr_t.close_short('251125-25002', 'PK ทำได้ไม่ครบ ลูกค้ารับ 3'), '251125-25002') ->> 'status', 'completed',
  'with every production job done WH closes the order short');
select is(cr_t.moves('251125-25002') -> -1 ->> 'note', 'PK ทำได้ไม่ครบ ลูกค้ารับ 3', 'the short close keeps the reason WH typed');

-- 11. ใบ 25005: ผู้ดูแลระบบปิดใบหลังฝ่ายวางแผนปิดงาน GR ------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select ok(cr_t.report('JOB-5-PK', 1, 'done') is not null, 'PK packs the 1 set of 25005');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select is(cr_t.receive('251125-25005', 1) -> 'changes' -> 'orders' -> 'upsert', '[]'::jsonb, 'an admin receives it while GR is open: the order stays open');
select throws_ok($$ select cr_t.close('251125-25005') $$, 'BOM_INVALID_TRANSITION', 'the admin cannot close it yet');
select ok(cr_t.close_job('JOB-5-GR', 'ชิ้นยางมีในคลังแล้ว') is not null, 'the admin is in the planning group and closes the GR job with a reason');
select is(cr_t.up_order(cr_t.close('251125-25005'), '251125-25005') ->> 'status', 'completed', 'then the admin closes the order');
select is(cr_t.moves('251125-25005') -> -1 ->> 'by', current_setting('test.n_sbx_admin_t'), 'the close move names the admin');

-- 12. ตาราง: ความสอดคล้องหลังการปิด (นับด้วยสิทธิ์เจ้าของตาราง) -------------------------------------------------------------
reset role;
select is((select count(*) from public.bom_orders where is_test and status = 'completed'), 5::bigint, 'five orders are completed, the draft is not');
select ok(not exists (
    select 1 from public.bom_orders o
    where o.is_test and o.status = 'completed'
      and exists (select 1 from public.bom_jobs j where j.order_pk = o.id and j.status <> 'done' and not (j.dept = 'ST' and j.kind = 'PURCHASED'))),
  'no completed order has an open production job');
select is((select count(*) from public.bom_fg_moves m join public.bom_orders o on o.id = m.order_pk
           where m.is_test and m.kind = 'close' and m.note = 'รับครบ ปิดใบโดยคลังสินค้า'), 2::bigint, 'two orders were closed in full by WH or the admin');
select is((select count(*) from public.bom_jobs j where j.is_test and j.status = 'done' and j.qty_done = 0
           and (j.reports -> -1 ->> 'good')::numeric = 0 and char_length(j.reports -> -1 ->> 'note') >= 3), 3::bigint,
  'three jobs were closed by the planning group with a reason and no output');
set local role authenticated;

select * from finish();
rollback;
