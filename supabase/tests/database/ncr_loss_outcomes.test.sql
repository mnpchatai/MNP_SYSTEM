begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok((select relrowsecurity from pg_class where oid='public.ncr_outcomes'::regclass),'outcomes have RLS');
select ok(not has_table_privilege('anon','public.ncr_outcomes','select'),'anon cannot read outcomes');
select ok(not has_table_privilege('authenticated','public.ncr_outcomes','insert'),'clients cannot insert outcomes directly');
select ok(not has_table_privilege('authenticated','public.ncr_outcomes','update'),'clients cannot update outcomes directly');
select ok(not has_table_privilege('authenticated','public.ncr_outcomes','delete'),'clients cannot delete outcomes directly');
select ok(not has_function_privilege('anon','public.app_ncr_record_loss(uuid,jsonb,uuid)','execute'),'anon cannot record costs');
select ok(not has_function_privilege('anon','public.app_ncr_save_outcome(uuid,jsonb)','execute'),'anon cannot save outcomes');
select ok(not has_function_privilege('authenticated','private.ncr_invalidate_cost_review()','execute'),'clients cannot bypass cost review');
select ok('ncr_outcomes'=any(private.sandbox_unguarded_tables()),'outcomes are registered as sandbox aware');
select ok(exists(select 1 from pg_trigger where tgrelid='public.ncr_outcomes'::regclass and tgname='ncr_outcomes_sandbox_scope'),'outcomes enforce sandbox scope');

insert into auth.users(id,email,raw_user_meta_data) values
 ('74000000-0000-0000-0000-000000000001','cost-admin@test.local','{}'),
 ('74000000-0000-0000-0000-000000000002','cost-other@test.local','{}');
insert into public.employees(id,employee_no,first_name,last_name,email,department_id,role_id,auth_user_id) values
 ('74000000-0000-0000-0000-000000000101','COST-ADMIN','Cost','Admin','cost-admin@test.local',(select id from public.departments where code='FT'),(select id from public.roles where code='admin'),'74000000-0000-0000-0000-000000000001'),
 ('74000000-0000-0000-0000-000000000102','COST-OTHER','Cost','Other','cost-other@test.local',(select id from public.departments where code='PK'),(select id from public.roles where code='staff'),'74000000-0000-0000-0000-000000000002');
select set_config('test.cost_qa',(select id::text from public.employees where employee_no='SBX-QA-STAFF'),true);
select set_config('test.cost_rb',(select id::text from public.employees where employee_no='SBX-RB-STAFF'),true);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"74000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('test.real_ncr',(public.app_ncr_issue('COSTREAL',1000,100,'ชิ้น','in_process','DIM','Real fixture for scope testing')->>'id'),true);
select throws_ok(format('select public.app_ncr_record_loss(%L::uuid,''{}''::jsonb)',current_setting('test.real_ncr')),'SANDBOX_ONLY','new costs API is restricted to test mode');
select public.app_sandbox_enter(current_setting('test.cost_qa')::uuid);
select set_config('test.cost_ncr',(public.app_ncr_issue('COSTTEST',1000,100,'ชิ้น','in_process','DIM','Sandbox fixture for outcome testing')->>'id'),true);
select set_config('test.entry',jsonb_build_object('loss_type','rework','entry_kind','loss','cost_status','estimated','component','labor','quantity',6,'unit','คน-ชม.','unit_cost',100,'incurred_on',current_date)::text,true);
select set_config('test.result',jsonb_build_object('result_status','confirmed','result_date',current_date,'qty_sorted',100,'qty_repaired',80,'qty_scrapped',20,'qty_returned',0,'qty_accepted',0,'downtime_hours',2,'evidence_ref','RESULT-01','cost_reviewed',false)::text,true);

select throws_ok(format('select public.app_ncr_record_loss(%L::uuid,%L::jsonb)',current_setting('test.real_ncr'),current_setting('test.entry')),'SANDBOX_ONLY','sandbox cannot record a cost on a real report');
select set_config('test.cost_id',public.app_ncr_record_loss(current_setting('test.cost_ncr')::uuid,current_setting('test.entry')::jsonb)::text,true);
select is((select amount from public.ncr_losses where id=current_setting('test.cost_id')::uuid),600.00::numeric,'labor is total person-hours times rate');
select is((select cost_status from public.ncr_losses where id=current_setting('test.cost_id')::uuid),'estimated','new entry stays estimated until reviewed');
select throws_ok(format('select public.app_ncr_record_loss(%L::uuid,%L::jsonb,%L::uuid)',current_setting('test.cost_ncr'),(current_setting('test.entry')::jsonb || '{"cost_status":"confirmed"}')::text,current_setting('test.cost_id')),'LOSS_EVIDENCE_REQUIRED','confirmation needs evidence');
select throws_ok(format('select public.app_ncr_save_outcome(%L::uuid,%L::jsonb)',current_setting('test.cost_ncr'),(current_setting('test.result')::jsonb || '{"cost_reviewed":true}')::text),'COST_REVIEW_PENDING','estimate prevents a complete review');
select lives_ok(format('select public.app_ncr_record_loss(%L::uuid,%L::jsonb,%L::uuid)',current_setting('test.cost_ncr'),(current_setting('test.entry')::jsonb || '{"cost_status":"confirmed","evidence_ref":"TIME-01","unit_cost":110}')::text,current_setting('test.cost_id')),'confirm replaces the estimate');
select is((select count(*) from public.ncr_losses where ncr_id=current_setting('test.cost_ncr')::uuid),1::bigint,'confirming does not create a second cost row');
select is((select amount from public.ncr_losses where id=current_setting('test.cost_id')::uuid),660.00::numeric,'updated actual amount replaces estimated amount');
select ok((select verified_by is not null and verified_at is not null from public.ncr_losses where id=current_setting('test.cost_id')::uuid),'confirmation records actor and time');
select lives_ok(format('select public.app_ncr_save_outcome(%L::uuid,%L::jsonb)',current_setting('test.cost_ncr'),(current_setting('test.result')::jsonb || '{"cost_reviewed":true}')::text),'verified final outcome with reviewed costs saves');
select is((select qty_scrapped from public.ncr_outcomes where ncr_id=current_setting('test.cost_ncr')::uuid),20.000::numeric,'actual scrap differs from detected defects');
select is((select qty_repaired from public.ncr_outcomes where ncr_id=current_setting('test.cost_ncr')::uuid),80.000::numeric,'repair success is recorded separately');
select throws_ok(format('select public.app_ncr_save_outcome(%L::uuid,%L::jsonb)',current_setting('test.cost_ncr'),(current_setting('test.result')::jsonb || '{"qty_scrapped":950}')::text),'OUTCOME_EXCEEDS_LOT','final outcomes cannot exceed the lot');
select throws_ok(format('select public.app_ncr_save_outcome(%L::uuid,%L::jsonb)',current_setting('test.cost_ncr'),(current_setting('test.result')::jsonb || '{"evidence_ref":""}')::text),'LOSS_EVIDENCE_REQUIRED','final outcome confirmation needs evidence');
select throws_ok(format('select public.app_ncr_record_loss(%L::uuid,%L::jsonb)',current_setting('test.cost_ncr'),(current_setting('test.entry')::jsonb || '{"quantity":"NaN"}')::text),'INVALID_LOSS','non-finite quantities are rejected');
select throws_ok(format('select public.app_ncr_record_loss(%L::uuid,%L::jsonb)',current_setting('test.cost_ncr'),(current_setting('test.entry')::jsonb || '{"loss_type":"other","component":"amount","quantity":1,"note":""}')::text),'INVALID_LOSS_NOTE','other still needs its explanation');
select lives_ok(format('select public.app_ncr_record_loss(%L::uuid,%L::jsonb)',current_setting('test.cost_ncr'),(current_setting('test.entry')::jsonb || '{"entry_kind":"recovery","component":"amount","quantity":1,"unit":"รายการ","unit_cost":100,"cost_status":"confirmed","evidence_ref":"CREDIT-01"}')::text),'recovery is stored separately');
select is((select sum(case when entry_kind='recovery' then -amount else amount end) from public.ncr_losses where ncr_id=current_setting('test.cost_ncr')::uuid and cost_status='confirmed'),560.00::numeric,'net confirmed amount subtracts recovery');
select ok(not (select cost_reviewed from public.ncr_outcomes where ncr_id=current_setting('test.cost_ncr')::uuid),'new costs invalidate the completed review');
select lives_ok(format('select public.app_ncr_save_outcome(%L::uuid,%L::jsonb)',current_setting('test.cost_ncr'),(current_setting('test.result')::jsonb || '{"cost_reviewed":true}')::text),'review can be repeated after all entries are confirmed');
select public.app_ncr_void_loss(current_setting('test.cost_id')::uuid,'incorrect time');
select ok(not (select cost_reviewed from public.ncr_outcomes where ncr_id=current_setting('test.cost_ncr')::uuid),'existing void API invalidates cost review too');
select throws_ok(format('select public.app_ncr_record_loss(%L::uuid,%L::jsonb,%L::uuid)',current_setting('test.cost_ncr'),current_setting('test.entry'),current_setting('test.cost_id')),'LOSS_ALREADY_VOIDED','voided entries cannot be revived');

select lives_ok(format('select public.app_ncr_record_loss(%L::uuid,%L::jsonb)',current_setting('test.cost_ncr'),(current_setting('test.entry')::jsonb || '{"loss_type":"repair"}')::text),'repair labor is a separate cost type from rework');
select is((select count(*) from public.ncr_losses where ncr_id=current_setting('test.cost_ncr')::uuid and loss_type='repair' and voided_at is null),1::bigint,'repair cost is stored as its own type');
select throws_ok(format('select public.app_ncr_record_loss(%L::uuid,%L::jsonb)',current_setting('test.cost_ncr'),(current_setting('test.entry')::jsonb || '{"loss_type":"repair","component":"quantity"}')::text),'INVALID_LOSS_COMPONENT','repair uses the same component rules as rework');
select lives_ok(format('select public.app_ncr_add_loss(%L::uuid,''repair'',2,''ชม.'',60,''ซ่อม'')',current_setting('test.cost_ncr')),'the older single-entry API also accepts repair');
select public.app_sandbox_enter(current_setting('test.cost_rb')::uuid);
select throws_ok(format('select public.app_ncr_record_loss(%L::uuid,%L::jsonb)',current_setting('test.cost_ncr'),current_setting('test.entry')),'NOT_AUTHORIZED','test staff cannot edit costs for another department');
select is((select count(*) from public.ncr_outcomes where ncr_id=current_setting('test.cost_ncr')::uuid),0::bigint,'unrelated persona cannot read the outcome');
select public.app_sandbox_exit();
select is((select count(*) from public.ncr_outcomes where ncr_id=current_setting('test.cost_ncr')::uuid),0::bigint,'real admin outside test mode cannot read test outcomes');
select set_config('request.jwt.claims','{"sub":"74000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.ncr_outcomes),0::bigint,'ordinary real user cannot read test outcomes');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok(format('select public.app_ncr_record_loss(%L::uuid,%L::jsonb)',current_setting('test.cost_ncr'),current_setting('test.entry')),'AUTH_REQUIRED','new API requires a session');
reset role;
select ok(exists(select 1 from public.ncr_status_history where ncr_id=current_setting('test.cost_ncr')::uuid and action='loss_record'),'cost updates have history');
select ok(exists(select 1 from public.ncr_status_history where ncr_id=current_setting('test.cost_ncr')::uuid and action='outcome_record'),'outcomes have history');
select * from finish();
rollback;
