-- ฝ่ายโรงงาน: วันหมดอายุและการกักกันล็อต + ตัดวัตถุดิบแบบ FEFO (20261030010000_factory_lot_fefo_quarantine.sql)
-- ครอบคลุม: โครงสร้างและสิทธิ์ ปฏิเสธนอกโหมดทดสอบ/ผิดแผนก การตรวจวันหมดอายุและเหตุผล ล็อกด้วย version
-- ตัดแบบ FEFO (ไม่ใช่ FIFO) ข้ามล็อตหมดอายุ/ถูกกักกัน สาเหตุเมื่อของไม่พอ ปลดกักกันแล้วตัดได้ ประวัติ audit และการล้างข้อมูลทดสอบ
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
select ok((select relrowsecurity from pg_class where relname = 'factory_lot_history'), 'the lot history table has RLS enabled');
select ok(not exists (
    select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.factory_lot_history', p.priv)),
  'anon and authenticated have no direct privilege on the lot history');
select ok(exists (select 1 from pg_trigger g where g.tgname = 'factory_lot_history_sandbox_scope' and not g.tgisinternal),
  'the lot history enforces sandbox scope by trigger');
select ok('factory_lot_history' = any (private.sandbox_unguarded_tables()) and 'factory_job_step_readings' = any (private.sandbox_unguarded_tables())
          and 'qc_inspection_history' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the earlier tables and adds the lot history');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0,
  'every public function, including the new and redefined ones, keeps the lab-only guard');
select ok(exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                  where c.relname = 'factory_lot_history' and p.polname = 'lab_only_no_access' and not p.polpermissive),
  'the lot history has the restrictive lab_only_no_access policy');
select ok(not has_function_privilege('anon', 'public.app_factory_lots()', 'execute')
      and not has_function_privilege('anon', 'public.app_factory_set_lot_expiry(uuid,integer,date)', 'execute')
      and not has_function_privilege('anon', 'public.app_factory_set_lot_hold(uuid,integer,boolean,text)', 'execute'),
  'anon cannot call the lot APIs');
select ok(has_function_privilege('authenticated', 'public.app_factory_lots()', 'execute')
      and has_function_privilege('authenticated', 'public.app_factory_set_lot_expiry(uuid,integer,date)', 'execute')
      and has_function_privilege('authenticated', 'public.app_factory_set_lot_hold(uuid,integer,boolean,text)', 'execute'),
  'signed-in users can call the lot APIs (they check mode and department themselves)');
select ok(not has_function_privilege('authenticated', 'private.factory_issue_stock(uuid,numeric,text,uuid,uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_lot_lock(uuid,integer)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_lot_usable(boolean,date)', 'execute'),
  'clients cannot call the private helpers');

-- 2. บัญชีทดสอบ -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('85000000-0000-0000-0000-000000000001', 'lot-admin@test.local', '{}'),
  ('85000000-0000-0000-0000-000000000002', 'lot-qa@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('85000000-0000-0000-0000-000000000101', 'LOT-ADMIN', 'Lot', 'Admin', 'lot-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '85000000-0000-0000-0000-000000000001'),
  ('85000000-0000-0000-0000-000000000102', 'LOT-QA', 'Lot', 'Qa', 'lot-qa@test.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '85000000-0000-0000-0000-000000000002');
select set_config('test.p_' || substr(employee_no, 5, 2), id::text, true) from public.employees where employee_no in
  ('SBX-SA-STAFF', 'SBX-PP-STAFF', 'SBX-RB-STAFF', 'SBX-ST-STAFF', 'SBX-QA-STAFF');
select set_config('test.due', ((now() at time zone 'Asia/Bangkok')::date + 30)::text, true);
select set_config('test.today', (now() at time zone 'Asia/Bangkok')::date::text, true);

create function pg_temp.item(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'code' = $1 $$;
create function pg_temp.bom(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'boms') x where x ->> 'code' = $1 and x ->> 'revision' = 'A' $$;
create function pg_temp.routing(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'routings') x where x ->> 'code' = $1 $$;
create function pg_temp.job(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_master_data() -> 'jobs') x where x ->> 'id' = $1 $$;
create function pg_temp.jver(text) returns integer language sql stable as $$ select (pg_temp.job($1) ->> 'version')::integer $$;
create function pg_temp.lot(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_lots() -> 'lots') x where x ->> 'lot_number' = $1 $$;
create function pg_temp.lid(text) returns uuid language sql stable as $$ select (pg_temp.lot($1) ->> 'id')::uuid $$;
create function pg_temp.lver(text) returns integer language sql stable as $$ select (pg_temp.lot($1) ->> 'version')::integer $$;
create function pg_temp.bal(text) returns numeric language sql stable as $$ select (pg_temp.lot($1) ->> 'balance')::numeric $$;
create function pg_temp.approve(text) returns text language plpgsql as $$
declare v_id text := pg_temp.bom($1);
begin
  perform public.app_factory_submit_bom(v_id::uuid, 1);
  perform public.app_factory_decide_bom(v_id::uuid, 2, 'approve', 'ทดสอบ');
  return v_id;
end $$;

set local role authenticated;

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.app_factory_lots()$$, 'AUTH_REQUIRED', 'reading lots needs a session');
select set_config('request.jwt.claims', '{"sub":"85000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_set_lot_hold('85000000-0000-0000-0000-00000000c001', 1, true, 'กักกันทดสอบนอกโหมด')$$,
  'FACTORY_TEST_MODE_ONLY', 'a real QA account cannot hold a lot');
select throws_ok($$select public.app_factory_set_lot_expiry('85000000-0000-0000-0000-00000000c001', 1, null)$$,
  'FACTORY_TEST_MODE_ONLY', 'a real QA account cannot set an expiry date');
select set_config('request.jwt.claims', '{"sub":"85000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_lots()$$, 'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot read lots');

-- 4. เตรียมข้อมูล: ชุดทดลอง ใบสั่งผลิตที่ออกใบสั่งงานแล้ว ----------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_SA')::uuid);
select is(public.app_sandbox_seed_factory_trial() ->> 'seeded', 'true', 'the trial set provides items, BOMs, routings and opening stock');
select lives_ok($$select pg_temp.approve('FG-TRY-001'), pg_temp.approve('WIP-TRY-RBL-001')$$, 'the BOMs are approved');
select set_config('test.wo', (public.app_factory_save_production_order(null, null, pg_temp.item('FG-TRY-001')::uuid, 12, current_setting('test.due')::date, '', '')) ->> 'id', true);
select public.app_factory_submit_production_order(current_setting('test.wo')::uuid, 1);
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select public.app_factory_receive_production_order(current_setting('test.wo')::uuid, 2);
select public.app_factory_plan_production_order(current_setting('test.wo')::uuid, 3, pg_temp.bom('FG-TRY-001')::uuid, pg_temp.routing('FG-TRY-001')::uuid, 'พอ');
select public.app_factory_release_production_order(current_setting('test.wo')::uuid, 4);
select set_config('test.rbl', pg_temp.item('WIP-TRY-RBL-001'), true);
select set_config('test.nr', pg_temp.item('RM-TRY-NR-001'), true);

-- ล็อตยางธรรมชาติเพิ่ม 3 ล็อต (เพิ่มตรงในฐานข้อมูล เพราะ RPC ไม่ให้ตั้งวันหมดอายุย้อนหลัง): FIFO จะหยิบ X ก่อน (รับเก่าสุด) แต่ X หมดอายุแล้ว
-- FEFO: A (หมด +5 วัน) → B (หมด +30 วัน แม้รับก่อน A) → LOT-TRY-002 ของชุดทดลอง (ไม่มีวันหมดอายุ)
reset role;
insert into public.factory_lots (item_id, lot_number, received_date, expiry_date) values
  (current_setting('test.nr')::uuid, 'LOT-FEFO-X', current_setting('test.today')::date - 30, current_setting('test.today')::date - 1),
  (current_setting('test.nr')::uuid, 'LOT-FEFO-B', current_setting('test.today')::date - 20, current_setting('test.today')::date + 30),
  (current_setting('test.nr')::uuid, 'LOT-FEFO-A', current_setting('test.today')::date - 10, current_setting('test.today')::date + 5);
insert into public.factory_inventory_movements (item_id, warehouse_id, lot_id, quantity, kind, reference)
select current_setting('test.nr')::uuid, w.id, l.id, v.qty, 'adjustment', 'ล็อตทดสอบ FEFO'
from (values ('LOT-FEFO-X', 500), ('LOT-FEFO-B', 100), ('LOT-FEFO-A', 50)) v(lot, qty)
join public.factory_lots l on l.lot_number = v.lot
join public.factory_warehouses w on w.is_test and w.code = 'RM';
select is((select count(*)::integer from public.factory_lots where lot_number like 'LOT-FEFO-%' and is_test), 3, 'the extra lots are test data');
set local role authenticated;

-- 5. อ่านล็อต ------------------------------------------------------------------------------
select is(pg_temp.lot('LOT-FEFO-X') ->> 'status', 'expired', 'a lot past its expiry date reads as expired');
select is(pg_temp.lot('LOT-FEFO-A') ->> 'status', 'available', 'a lot before its expiry date is available');
select is(pg_temp.lot('LOT-TRY-002') ->> 'expiry_date', null, 'the trial lots have no expiry date');
select is(pg_temp.bal('LOT-FEFO-B'), 100::numeric, 'the lot balance sums its movements');
select is((public.app_factory_lots() ->> 'can_hold')::boolean, false, 'planning does not see the hold buttons');
select is(public.app_factory_lots() ->> 'today', current_setting('test.today'), 'the page gets today in Thai time');

-- 6. ตัดแบบ FEFO ---------------------------------------------------------------------------
-- ยางเส้นยาว 100 กก.: ยางธรรมชาติ 62 × 1.02 = 63.24 กก. → A 50 + B 13.24 · X (หมดอายุ) และ LOT-TRY-002 ไม่ถูกแตะ
select set_config('test.j1', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.rbl')::uuid, 100, 'SR', '')) ->> 'id', true);
select set_config('test.j2', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.rbl')::uuid, 100, 'SR', '')) ->> 'id', true);
select set_config('test.j3', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.rbl')::uuid, 1000, 'SR', '')) ->> 'id', true);
select set_config('test.try2', pg_temp.bal('LOT-TRY-002')::text, true);
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select lives_ok(format($$select public.app_factory_complete_job_step(%L::uuid, %s, 10, '', null)$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'the first step issues the materials');
select is(pg_temp.bal('LOT-FEFO-A'), 0::numeric, 'the lot that expires first is used up first');
select is(pg_temp.bal('LOT-FEFO-B'), 86.76::numeric, 'the rest comes from the next expiry, although it was received earlier');
select is(pg_temp.bal('LOT-FEFO-X'), 500::numeric, 'the expired lot is skipped although it was received first');
select is(pg_temp.bal('LOT-TRY-002'), current_setting('test.try2')::numeric, 'the lot without an expiry date is used last');

-- 7. วันหมดอายุ: ST หรือ QA --------------------------------------------------------------------
select throws_ok(format($$select public.app_factory_set_lot_expiry(%L::uuid, %s, %L::date)$$, pg_temp.lid('LOT-TRY-002'), pg_temp.lver('LOT-TRY-002'), current_setting('test.due')),
  'LOT_EXPIRY_STORES_OR_QA_ONLY', 'the production line cannot set an expiry date');
select public.app_sandbox_enter(current_setting('test.p_ST')::uuid);
select is((public.app_factory_lots() ->> 'can_set_expiry')::boolean, true, 'stores see the expiry form');
select throws_ok(format($$select public.app_factory_set_lot_expiry(%L::uuid, %s, %L::date)$$, '85000000-0000-0000-0000-00000000c001', 1, current_setting('test.due')),
  'LOT_NOT_FOUND', 'an unknown lot is rejected');
select throws_ok(format($$select public.app_factory_set_lot_expiry(%L::uuid, %s, %L::date)$$, pg_temp.lid('LOT-TRY-002'), pg_temp.lver('LOT-TRY-002') + 1, current_setting('test.due')),
  'LOT_STALE', 'a stale version is rejected');
select throws_ok(format($$select public.app_factory_set_lot_expiry(%L::uuid, %s, %L::date)$$, pg_temp.lid('LOT-TRY-002'), pg_temp.lver('LOT-TRY-002'), (current_setting('test.today')::date - 1)::text),
  'INVALID_LOT_EXPIRY', 'an expiry date before the receipt date is rejected');
select throws_ok(format($$select public.app_factory_set_lot_expiry(%L::uuid, %s, %L::date)$$, pg_temp.lid('LOT-TRY-002'), pg_temp.lver('LOT-TRY-002'), '2101-01-01'),
  'INVALID_LOT_EXPIRY', 'an expiry date after 2100 is rejected');
select throws_ok(format($$select public.app_factory_set_lot_expiry(%L::uuid, %s, null)$$, pg_temp.lid('LOT-TRY-002'), pg_temp.lver('LOT-TRY-002')),
  'LOT_EXPIRY_UNCHANGED', 'setting the same expiry date is rejected');
select is((public.app_factory_set_lot_expiry(pg_temp.lid('LOT-TRY-002'), pg_temp.lver('LOT-TRY-002'), current_setting('test.due')::date) ->> 'expiry_date'),
  current_setting('test.due'), 'stores set the expiry date');
select is(pg_temp.lot('LOT-TRY-002') ->> 'expiry_date', current_setting('test.due'), 'the lot shows the new expiry date');
select public.app_sandbox_enter(current_setting('test.p_QA')::uuid);
select lives_ok(format($$select public.app_factory_set_lot_expiry(%L::uuid, %s, null)$$, pg_temp.lid('LOT-TRY-002'), pg_temp.lver('LOT-TRY-002')),
  'QA can clear the expiry date');

-- 8. กักกัน/ปลด: QA เท่านั้น -----------------------------------------------------------------------
select set_config('test.acc', 'LOT-TRY-006', true);
select is(pg_temp.lot(current_setting('test.acc')) ->> 'item_code', 'RM-TRY-ACC-001', 'the accelerator has a single trial lot');
select throws_ok(format($$select public.app_factory_set_lot_hold(%L::uuid, %s, true, 'สั้น')$$, pg_temp.lid(current_setting('test.acc')), pg_temp.lver(current_setting('test.acc'))),
  'LOT_HOLD_NOTE_REQUIRED', 'a hold needs a reason of at least 10 characters');
select throws_ok(format($$select public.app_factory_set_lot_hold(%L::uuid, %s, null, 'เหตุผลยาวพอสำหรับทดสอบ')$$, pg_temp.lid(current_setting('test.acc')), pg_temp.lver(current_setting('test.acc'))),
  'INVALID_LOT_HOLD', 'the decision must be given');
select throws_ok(format($$select public.app_factory_set_lot_hold(%L::uuid, %s, false, 'ปลดล็อตที่ไม่ได้กักกัน')$$, pg_temp.lid(current_setting('test.acc')), pg_temp.lver(current_setting('test.acc'))),
  'LOT_NOT_HELD', 'a lot that is not held cannot be released');
select is((public.app_factory_set_lot_hold(pg_temp.lid(current_setting('test.acc')), pg_temp.lver(current_setting('test.acc')), true, 'ผล MDR ไม่ผ่าน รอตรวจซ้ำ') ->> 'on_hold')::boolean,
  true, 'QA holds the lot');
select is(pg_temp.lot(current_setting('test.acc')) ->> 'status', 'hold', 'the held lot reads as held');
select is(pg_temp.lot(current_setting('test.acc')) ->> 'hold_reason', 'ผล MDR ไม่ผ่าน รอตรวจซ้ำ', 'the hold reason is kept');
select throws_ok(format($$select public.app_factory_set_lot_hold(%L::uuid, %s, true, 'กักกันซ้ำอีกครั้งหนึ่ง')$$, pg_temp.lid(current_setting('test.acc')), pg_temp.lver(current_setting('test.acc'))),
  'LOT_ALREADY_HELD', 'a held lot cannot be held again');
select public.app_sandbox_enter(current_setting('test.p_ST')::uuid);
select throws_ok(format($$select public.app_factory_set_lot_hold(%L::uuid, %s, false, 'คลังขอปลดล็อตนี้เอง')$$, pg_temp.lid(current_setting('test.acc')), pg_temp.lver(current_setting('test.acc'))),
  'LOT_HOLD_QA_ONLY', 'stores cannot release a held lot');

-- 9. ล็อตที่ถูกกักกันไม่ถูกตัด และบอกสาเหตุ ---------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, %s, 10, '', null)$$, current_setting('test.j2'), pg_temp.jver(current_setting('test.j2'))),
  'JOB_STOCK_LOT_BLOCKED', 'the only accelerator lot is held, so the step says the stock is blocked');
select is(pg_temp.bal('LOT-FEFO-B'), 86.76::numeric, 'and nothing is issued (the whole transaction is undone)');
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, %s, 10, '', null)$$, current_setting('test.j3'), pg_temp.jver(current_setting('test.j3'))),
  'JOB_INSUFFICIENT_STOCK', 'when even the held stock would not cover the need, the step says the stock is short');
select public.app_sandbox_enter(current_setting('test.p_QA')::uuid);
select lives_ok(format($$select public.app_factory_set_lot_hold(%L::uuid, %s, false, 'MDR ซ้ำผ่าน ปล่อยใช้งานได้')$$, pg_temp.lid(current_setting('test.acc')), pg_temp.lver(current_setting('test.acc'))),
  'QA releases the lot');
select is(pg_temp.lot(current_setting('test.acc')) ->> 'status', 'available', 'the released lot is available again');
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select lives_ok(format($$select public.app_factory_complete_job_step(%L::uuid, %s, 10, '', null)$$, current_setting('test.j2'), pg_temp.jver(current_setting('test.j2'))),
  'after the release the step issues the materials');
select is(pg_temp.bal('LOT-FEFO-B'), 23.52::numeric, 'and the natural rubber again comes from the lot that expires first');

-- 10. ประวัติและ audit ----------------------------------------------------------------------------
select is((select string_agg(x ->> 'action', ',' order by x ->> 'created_at') from jsonb_array_elements(public.app_factory_lots() -> 'history') x),
  'expiry,expiry,hold,release', 'the lot history lists every change');
select is((select x ->> 'expiry_after' from jsonb_array_elements(public.app_factory_lots() -> 'history') x where x ->> 'action' = 'expiry' order by x ->> 'created_at' limit 1),
  current_setting('test.due'), 'the history keeps the expiry date that was set');
reset role;
select is((select count(*) from public.audit_logs where action in ('FACTORY_LOT_EXPIRY', 'FACTORY_LOT_HOLD', 'FACTORY_LOT_RELEASE'))::integer, 4,
  'every lot change is audited');
select is((select actor_id from public.audit_logs where action = 'FACTORY_LOT_HOLD'), '85000000-0000-0000-0000-000000000101'::uuid,
  'the audit names the real admin behind the persona');
set local role authenticated;

-- 11. ล้างข้อมูลทดสอบรวมตารางใหม่ ---------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"85000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok((public.app_sandbox_factory_test_data() -> 'counts' ->> 'details')::integer > 0, 'the test data summary counts the details');
select ok((public.app_sandbox_purge_factory() ->> 'deleted')::integer > 0, 'the factory purge removes the test data');
select is(public.app_factory_lots() -> 'lots', '[]'::jsonb, 'no lot remains');
reset role;
select is((select count(*) from public.factory_lot_history)::integer, 0, 'the lot history is empty');

select * from finish();
rollback;
