-- ============================================================================
-- BOM โหมดทดสอบ: ของสำเร็จรูปที่ผลิตเกินกลายเป็นสต็อกสินค้าสำเร็จรูป และใบร่างอื่นใช้สต็อกนี้ลดการผลิตได้ (โหมดทดสอบเท่านั้น)
--
-- ทำไม: ผู้ใช้ตัดสิน 2026-11-16 ว่าส่วนที่ PK ผลิตเกินจำนวนสั่งต้องรับเข้าคลังได้ (รวมหลังใบปิดแล้ว) และกลายเป็นสต็อกของรหัสสินค้านั้น
--   ใบร่างอื่นที่สั่งสินค้าเดียวกันหยิบไปใช้ได้ ทุกแผนกจึงผลิตน้อยลง · เดิม (20261121010000) ใบที่ completed รับของไม่ได้ และของสำเร็จรูปในคลังไม่ลดงานของใบใด
--
-- นิยาม (ต่อใบ O และรหัสสินค้า X · ตามสัญญา bom-fg-stock-contract)
--   own = Σ receive ของ O · in = Σ transfer - Σ untransfer ที่ order_pk = O (รับจากสต็อก) · out = Σ transfer - Σ untransfer ที่ from_order_pk = O (ให้ใบอื่นไป)
--   delivered = Σ deliver ของ O · have = own + in (แทน "รับสะสม" ทุกจุดที่ 20261121010000 เทียบกับจำนวนสั่ง)
--   free(O, X) = max(0, have - out - max(สั่ง, delivered)) เฉพาะใบ released / in_progress / completed · สต็อกของ X = Σ free ทุกใบ
--   ของที่ยังต้องส่งลูกค้าของใบตัวเองไม่นับเป็นสต็อกของใบอื่นเลย (max(สั่ง, delivered))
--
-- สิ่งที่เปลี่ยน
--   1) ตาราง bom_fg_moves: ชนิดใหม่ transfer / untransfer และคอลัมน์ from_order_pk (foreign key คู่ (from_order_pk, is_test) แบบเดียวกับ order_pk)
--      transfer / untransfer ต้องมี from_order_pk และ <> order_pk · ชนิดอื่น from_order_pk เป็น null · fg_code 1-60 qty > 0 · แถว transfer เป็นของใบปลายทาง (order_pk)
--      ยังเขียนต่อท้ายโดยเซิร์ฟเวอร์เท่านั้น (RLS / สิทธิ์ตาราง / trigger เดิม) · ดัชนี (from_order_pk, is_test) สำหรับผลรวมต่อใบต้นทาง (และฝั่งลูกของ foreign key ใหม่)
--   2) ตัวช่วยใหม่ private.bom_fg_in / bom_fg_out / bom_fg_have / bom_fg_free / bom_fg_stock และ private.bom_fg_return_stock (คืนสต็อกตอนยกเลิก / เปิดกลับ)
--   3) private.bom_fg_move: receiveFg รับได้ทั้ง released / in_progress / completed (เพดานเดิม own + qty <= qty_done ของงาน PK / FG)
--      ปิดใบอัตโนมัติเมื่อใบยังไม่ completed และทุกสินค้า have >= สั่ง · deliverFg เพดาน delivered + qty <= have - out
--      closeOrderShort: ทุกงาน PK done · ทุกสินค้า own = qty_done ของ PK · อย่างน้อยหนึ่งสินค้า have < สั่ง
--   4) private.bom_save_orders:
--      - ปล่อยผลิต (draft -> released): ทุกสินค้าที่ stockCounts[fgCode] = n > 0 · n > จำนวนสั่ง = BOM_INVALID_ORDER · สต็อกของรหัสนั้น < n = BOM_FG_EXCEEDS
--        หยิบ n จากใบต้นทางที่ released_at เก่าสุดก่อน (เสมอกันใช้เลข PI) เขียน transfer หนึ่งแถวต่อใบต้นทาง (note ว่าง)
--        หลังหยิบ ถ้าทุกสินค้า have >= สั่ง (มาจากสต็อกทั้งหมด) ใบเป็น completed ในคำสั่งเดียวกัน (ตั้งทั้ง released_at และ completed_at)
--      - คีย์ของ stockCounts ที่เป็นสินค้าของใบ แก้ได้เฉพาะกลุ่มวางแผน · ST / WH แก้คีย์อื่นของใบร่างได้เหมือนเดิม (แก้คีย์สินค้า = BOM_FORBIDDEN)
--      - ยกเลิก (released / in_progress -> cancelled) และเปิดกลับเป็นร่าง: ใบที่มีประวัติส่งมอบ หรือให้สต็อกใบอื่นไปแล้ว (out > 0 รหัสใดก็ตาม) = BOM_INVALID_TRANSITION
--        ไม่เช่นนั้นเขียน untransfer ต่อ (ใบต้นทาง, รหัส) ที่ in สุทธิ > 0 (qty = in สุทธิ) · stockCounts คงไว้เมื่อเปิดกลับ (เหมือนเดิม)
--      - คืน { released, cancelled, reopened, fgMoves } (fgMoves = จำนวนแถว transfer / untransfer ที่เขียน) ชนิดคืน jsonb เดิม
--   5) public.app_bom_save_master: audit นับ transfer / untransfer จาก bom_save_orders เป็น fgMoves upsert
--      ด่าน "ใบที่ปล่อยผลิตต้องมีงาน" ยกเว้นใบที่ completed ในคำสั่งเดียวกัน (มาจากสต็อกทั้งหมด จึงไม่มีงาน)
--   6) private.bom_records: เรคอร์ด fgMoves ชนิด transfer / untransfer มีช่อง fromOrderId (เลข PI ของใบต้นทาง) ชนิดอื่นไม่มีช่องนี้ (รูปเดิม 8 ช่อง)
--   ไม่เปลี่ยน: private.bom_save_jobs (ด่านของ #369 เทียบกับ own ผ่าน private.bom_fg_total ชนิด receive อยู่แล้ว ไม่นับ transfer) · private.bom_delta (อ่านชุดจาก bom_records)
--      public.app_sandbox_purge_bom (ลบ bom_fg_moves ก่อน bom_orders อยู่แล้ว foreign key ใหม่จึงไม่ขวาง) · private.bom_fg_total / bom_fg_pk_done
--      ทุกการบันทึก BOM ต่อคิวกันด้วย advisory lock และล็อกแถว bom_master_state ใน app_bom_save_master ยอดสต็อกที่อ่านตอนปล่อยผลิตจึงไม่ถูกแซง
--
-- นิยามที่ replace (create or replace ลายเซ็นเดิม เริ่มจากนิยามล่าสุดบน main · security definer + set search_path = '' และ revoke / grant เหมือนต้นทาง)
--   - private.bom_fg_move(public.employees, text, jsonb) จาก 20261121010000_bom_fg_receive_deliver.sql
--   - private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) จาก 20261121010000_bom_fg_receive_deliver.sql
--   - private.bom_records(bigint) จาก 20261121010000_bom_fg_receive_deliver.sql
--   - public.app_bom_save_master(jsonb, bigint, text, jsonb, text) จาก 20261122010000_bom_fg_guards.sql
--     (revoke all from public, anon · grant execute to authenticated · perform private.lab_only_block() ต้นฟังก์ชันเหมือนเดิม)
--   ใหม่: private.bom_fg_in, bom_fg_out, bom_fg_have, bom_fg_free, bom_fg_stock, bom_fg_return_stock (revoke all from public, anon, authenticated)
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้ตั้ง stockCounts[รหัสสินค้า] ของใบร่าง ลดงาน PK เป็น สั่ง - n และอ่าน transfer จากชุด fgMoves
--   จึงต้อง apply ไฟล์นี้ที่ production (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge PR ตาม "Deployment order" ใน AGENTS.md
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของสี่ฟังก์ชันที่ replace ข้างบนที่ production กับนิยามในไฟล์ต้นทางที่ระบุ
--   (ถ้ามี migration อื่นแก้ไปแล้วต้องเริ่มจากนิยามล่าสุด) แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ · หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test
--   และตรวจ has_function_privilege (anon เรียก app_bom_save_master ไม่ได้, authenticated เรียกได้, private.* เรียกไม่ได้) และ constraint ของ bom_fg_moves
--   Pilot รุ่นเก่ากับฐานข้อมูลใหม่: แถว FG ในหน้าตรวจของของรุ่นเก่า (ยอดนับของสำเร็จรูปตามใบ) ถูกอ่านเป็น "หยิบจากสต็อก" ตอนปล่อยผลิต
--     ST / WH แก้ช่องนั้นได้ BOM_FORBIDDEN · กลุ่มวางแผนที่กรอกไว้ ปล่อยผลิตแล้วได้ BOM_FG_EXCEEDS (สต็อกไม่พอ) หรือ BOM_INVALID_ORDER (เกินจำนวนสั่ง)
--     หรือถูกหยิบสต็อกจริงขณะที่รุ่นเก่าสร้างงาน PK เต็มจำนวน · ใบร่างทดสอบที่มีคีย์สินค้าใน stockCounts อยู่แล้วควรล้างคีย์นั้นก่อนปล่อยผลิต
--     แถว transfer / untransfer ในชุด fgMoves รุ่นเก่าไม่รู้จักชนิด (นับเป็นรับ/ส่งมอบไม่ได้) ส่วนอื่นทำงานปกติ
--   Pilot รุ่นใหม่กับฐานข้อมูลเก่า: stockCounts[รหัสสินค้า] ถูกเก็บแต่ไม่หยิบสต็อก ใบจึงไม่ครบ (have = own) และปิดเองไม่ได้ · รับของหลังปิดใบได้ BOM_INVALID_TRANSITION
--     ใบที่มาจากสต็อกทั้งหมด (ไม่มีงาน) ปล่อยผลิตไม่ได้ (BOM_INVALID_TRANSITION) · จึงห้าม merge ก่อน apply
--
-- Rollback (ข้อมูลทดสอบเท่านั้น) ลำดับสำคัญ:
--   1) create or replace สี่ฟังก์ชันกลับด้วยนิยามต้นทางที่ระบุข้างบน (รวม revoke / grant ท้ายฟังก์ชัน)
--   2) drop function private.bom_fg_return_stock(uuid, uuid), private.bom_fg_stock(text), private.bom_fg_free(uuid, text), private.bom_fg_have(uuid, text),
--      private.bom_fg_out(uuid, text), private.bom_fg_in(uuid, text)
--   3) delete from public.bom_fg_moves where kind in ('transfer', 'untransfer') (ประวัติหยิบสต็อกของโหมดทดสอบหายไป ใบที่หยิบไปแล้วจะมี have เท่ากับ own)
--      แล้ว alter table: drop constraint bom_fg_moves_shape_check / bom_fg_moves_kind_check และสร้างกลับตาม 20261121010000, drop index bom_fg_moves_from_order_idx,
--      drop constraint bom_fg_moves_from_order_fkey, drop column from_order_pk
--      ใบที่ completed ตอนปล่อยผลิตจากสต็อก (ไม่มีงาน) คงเป็น completed
-- ============================================================================

-- 1. ตาราง: ชนิด transfer / untransfer และใบต้นทาง ---------------------------------------------------------------
alter table public.bom_fg_moves add column from_order_pk uuid;
comment on column public.bom_fg_moves.from_order_pk is 'ใบต้นทางของสต็อกที่ถูกหยิบ (transfer) หรือคืน (untransfer) · null สำหรับ receive / deliver / close · แถวเป็นของใบปลายทาง (order_pk)';
-- foreign key คู่กับ is_test แบบเดียวกับ order_pk (แถวโหมดทดสอบชี้ใบจริงไม่ได้) · ไม่ cascade: purge ลบตารางนี้ก่อน bom_orders
alter table public.bom_fg_moves add constraint bom_fg_moves_from_order_fkey
  foreign key (from_order_pk, is_test) references public.bom_orders(id, is_test);
-- ชื่ออัตโนมัติของ check ระดับคอลัมน์ใน 20261121010000 (kind text not null check (...)) · ชื่อผิดให้ล้มดีกว่าค้าง check เดิมไว้
alter table public.bom_fg_moves drop constraint bom_fg_moves_kind_check;
alter table public.bom_fg_moves add constraint bom_fg_moves_kind_check
  check (kind in ('receive', 'deliver', 'close', 'transfer', 'untransfer'));
alter table public.bom_fg_moves drop constraint bom_fg_moves_shape_check;
alter table public.bom_fg_moves add constraint bom_fg_moves_shape_check check (
  (kind = 'close' and fg_code = '' and qty = 0 and char_length(note) between 3 and 300 and from_order_pk is null)
  or (kind in ('receive', 'deliver') and char_length(fg_code) between 1 and 60 and qty > 0 and from_order_pk is null)
  or (kind in ('transfer', 'untransfer') and char_length(fg_code) between 1 and 60 and qty > 0
      and from_order_pk is not null and from_order_pk <> order_pk));
-- ผลรวมต่อใบต้นทาง (out / สต็อก) และฝั่งลูกของ foreign key ใหม่ (ลบใบตอน purge ไม่ต้องสแกนทั้งตาราง)
create index bom_fg_moves_from_order_idx on public.bom_fg_moves (from_order_pk, is_test);
comment on table public.bom_fg_moves is 'ประวัติรับของสำเร็จรูปเข้าคลัง (receive) ส่งมอบลูกค้า (deliver) ปิดใบรับไม่ครบ (close) และหยิบ / คืนสต็อกสินค้าสำเร็จรูประหว่างใบ (transfer / untransfer) · เขียนผ่าน app_bom_save_master เท่านั้น ไม่มีสิทธิ์เขียนจาก client';

-- 2. ตัวช่วย (private เรียกจากตัวเขียนใน app_bom_save_master เท่านั้น) ---------------------------------------------------
-- in: ที่ใบนี้หยิบจากสต็อก (transfer - untransfer ที่ order_pk = ใบนี้) ของรหัสนั้น
create or replace function private.bom_fg_in(p_order_pk uuid, p_code text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when m.kind = 'transfer' then m.qty else -m.qty end), 0)
  from public.bom_fg_moves m
  where m.is_test and m.order_pk = p_order_pk and m.fg_code = p_code and m.kind in ('transfer', 'untransfer')
$$;
revoke all on function private.bom_fg_in(uuid, text) from public, anon, authenticated;

-- out: ที่ใบอื่นหยิบไปจากใบนี้ (transfer - untransfer ที่ from_order_pk = ใบนี้) ของรหัสนั้น
create or replace function private.bom_fg_out(p_order_pk uuid, p_code text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when m.kind = 'transfer' then m.qty else -m.qty end), 0)
  from public.bom_fg_moves m
  where m.is_test and m.from_order_pk = p_order_pk and m.fg_code = p_code and m.kind in ('transfer', 'untransfer')
$$;
revoke all on function private.bom_fg_out(uuid, text) from public, anon, authenticated;

-- have = own (รับจากการผลิตของใบเอง) + in (หยิบจากสต็อก)
create or replace function private.bom_fg_have(p_order_pk uuid, p_code text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select private.bom_fg_total(p_order_pk, p_code, 'receive') + private.bom_fg_in(p_order_pk, p_code)
$$;
revoke all on function private.bom_fg_have(uuid, text) from public, anon, authenticated;

-- free = max(0, have - out - max(สั่ง, delivered)) เฉพาะใบ released / in_progress / completed (ใบอื่นหรือไม่พบใบ = 0)
-- ของที่ยังต้องส่งให้ลูกค้าของใบตัวเอง (จำนวนสั่ง หรือที่ส่งไปแล้วถ้ามากกว่า) ไม่นับเป็นสต็อก
create or replace function private.bom_fg_free(p_order_pk uuid, p_code text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select greatest(0, private.bom_fg_have(o.id, p_code) - private.bom_fg_out(o.id, p_code)
             - greatest(coalesce((select sum((it ->> 'qty')::numeric) from jsonb_array_elements(o.items) it where it ->> 'fgCode' = p_code), 0),
                        private.bom_fg_total(o.id, p_code, 'deliver')))
    from public.bom_orders o
    where o.is_test and o.id = p_order_pk and o.status in ('released', 'in_progress', 'completed')), 0)
$$;
revoke all on function private.bom_fg_free(uuid, text) from public, anon, authenticated;

-- สต็อกสินค้าสำเร็จรูปของรหัสหนึ่ง = Σ free ทุกใบ · ใบที่ไม่มีประวัติของรหัสนั้นเลย (ในฐานะใบของแถว) มี have = 0 จึง free = 0 ข้ามได้
create or replace function private.bom_fg_stock(p_code text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(private.bom_fg_free(o.id, p_code)), 0)
  from public.bom_orders o
  where o.is_test and o.status in ('released', 'in_progress', 'completed')
    and exists (select 1 from public.bom_fg_moves m where m.is_test and m.order_pk = o.id and m.fg_code = p_code)
$$;
revoke all on function private.bom_fg_stock(text) from public, anon, authenticated;

-- ยกเลิก / เปิดกลับเป็นร่าง: ใบที่ส่งมอบไปแล้ว หรือให้สต็อกใบอื่นไปแล้ว (out สุทธิ > 0 รหัสใดก็ตาม) = BOM_INVALID_TRANSITION
-- ไม่เช่นนั้นคืนที่หยิบมา: untransfer หนึ่งแถวต่อ (ใบต้นทาง, รหัส) ที่ in สุทธิ > 0 (qty = in สุทธิ) · คืนจำนวนแถวที่เขียน
create or replace function private.bom_fg_return_stock(p_order_pk uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if exists (select 1 from public.bom_fg_moves m where m.is_test and m.order_pk = p_order_pk and m.kind = 'deliver') then
    raise exception 'BOM_INVALID_TRANSITION';
  end if;
  if exists (
    select 1 from public.bom_fg_moves m
    where m.is_test and m.from_order_pk = p_order_pk and m.kind in ('transfer', 'untransfer')
    group by m.fg_code
    having sum(case when m.kind = 'transfer' then m.qty else -m.qty end) > 0) then
    raise exception 'BOM_INVALID_TRANSITION';
  end if;
  insert into public.bom_fg_moves (is_test, order_pk, from_order_pk, fg_code, kind, qty, note, created_by)
  select true, p_order_pk, t.from_order_pk, t.fg_code, 'untransfer', t.net, '', p_actor
  from (
    select m.from_order_pk, m.fg_code, sum(case when m.kind = 'transfer' then m.qty else -m.qty end) as net
    from public.bom_fg_moves m
    where m.is_test and m.order_pk = p_order_pk and m.kind in ('transfer', 'untransfer')
    group by m.from_order_pk, m.fg_code) t
  join public.bom_orders s on s.id = t.from_order_pk
  where t.net > 0
  order by t.fg_code collate "C", s.released_at, s.pi_no collate "C";
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.bom_fg_return_stock(uuid, uuid) from public, anon, authenticated;

-- 3. รับเข้าคลัง / ส่งมอบ / ปิดใบรับไม่ครบ (นิยามจาก 20261121010000_bom_fg_receive_deliver.sql: รับหลังปิดใบได้ · have แทนรับสะสม · ส่งมอบไม่เกิน have - out) ----------
-- รับเข้าคลัง / ส่งมอบ / ปิดใบรับไม่ครบ (action receiveFg / deliverFg / closeOrderShort) · แถวเดียว { orderId, kind, lines?, note? } · คืน { moves, closed }
-- ลำดับตรวจ: รูปแถว (BOM_INVALID_FG) -> สิทธิ์ แผนก WH หรือ admin (BOM_FORBIDDEN) -> ล็อกแถวใบ (ไม่พบใบ / สินค้าไม่ใช่รายการของใบ = BOM_INVALID_FG)
--   -> สถานะ (BOM_INVALID_TRANSITION) -> ยอด (BOM_FG_EXCEEDS) · ผลทั้งหมดคำนวณที่เซิร์ฟเวอร์ ไม่เชื่อค่าที่ client คำนวณ · กลุ่มวางแผนที่ไม่ใช่ WH / admin ดูอย่างเดียว
create or replace function private.bom_fg_move(p_actor public.employees, p_action text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_el jsonb;
  v_expected text;
  v_kind text;
  v_pi text;
  v_note text;
  v_codes text[] := '{}';
  v_qtys numeric[] := '{}';
  v_code text;
  v_qty numeric;
  v_ord public.bom_orders%rowtype;
  v_item jsonb;
  v_received numeric;
  v_short boolean := false;
  v_n integer := 0;
  v_close boolean := false;
begin
  -- รูปแถว (ก่อนสิทธิ์ เหมือนตัวเขียนอื่น)
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_FG'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_FG'; end if;
  v_expected := case p_action when 'receiveFg' then 'receive' when 'deliverFg' then 'deliver' when 'closeOrderShort' then 'close' end;
  v_kind := private.bom_text(v_row, 'kind', 10, 1, 'BOM_INVALID_FG');
  if v_expected is null or v_kind <> v_expected then raise exception 'BOM_INVALID_FG'; end if;
  v_pi := upper(private.bom_text(v_row, 'orderId', 40, 1, 'BOM_INVALID_FG'));
  v_node := v_row -> 'lines';
  if v_kind = 'close' then
    if v_node is not null and jsonb_typeof(v_node) <> 'null' and not (jsonb_typeof(v_node) = 'array' and jsonb_array_length(v_node) = 0) then
      raise exception 'BOM_INVALID_FG';
    end if;
    v_note := private.bom_text(v_row, 'note', 300, 3, 'BOM_INVALID_FG');
  else
    if v_node is null or jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) not between 1 and 500 then raise exception 'BOM_INVALID_FG'; end if;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'object' then raise exception 'BOM_INVALID_FG'; end if;
      v_code := private.bom_code(private.bom_text(v_el, 'fgCode', 60, 1, 'BOM_INVALID_FG'));
      if v_code = any (v_codes) then raise exception 'BOM_INVALID_FG'; end if;
      v_qty := private.bom_num(v_el -> 'qty', 'BOM_INVALID_FG', 0, 1000000000);
      if v_qty is null or v_qty <= 0 then raise exception 'BOM_INVALID_FG'; end if;
      v_codes := v_codes || v_code;
      v_qtys := v_qtys || v_qty;
    end loop;
    v_note := private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_FG');
  end if;

  -- สิทธิ์: พนักงานแผนก WH (ทุกบทบาทของแผนก) หรือบทบาท admin · กลุ่มวางแผน (PP) ไม่มีสิทธิ์รับ/ส่งมอบ/ปิดใบ
  if not (coalesce(private.bom_dept_of(p_actor) = 'WH', false) or coalesce(private.employee_role_code(p_actor.id) = 'admin', false)) then
    raise exception 'BOM_FORBIDDEN';
  end if;

  -- ล็อกแถวใบ: การรับ/ส่งมอบพร้อมกันของใบเดียวกันต่อคิวกัน ยอดรวมที่ตรวจจึงไม่ถูกแซง
  select * into v_ord from public.bom_orders o where o.is_test and o.pi_no = v_pi for update;
  if not found then raise exception 'BOM_INVALID_FG'; end if;
  for i in 1 .. cardinality(v_codes) loop
    if not exists (select 1 from jsonb_array_elements(v_ord.items) it where it ->> 'fgCode' = v_codes[i]) then raise exception 'BOM_INVALID_FG'; end if;
  end loop;

  if v_kind = 'receive' then
    -- รับได้ทั้งหลังปิดใบ (completed): ส่วนที่ PK ผลิตเกินจำนวนสั่งกลายเป็นสต็อกสินค้าสำเร็จรูป (20261123010000)
    if v_ord.status not in ('released', 'in_progress', 'completed') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    -- รับสะสมของใบเอง (own) ของสินค้าหนึ่งเกินที่ PK รายงานแล้ว (qty_done ของงาน PK) ไม่ได้ · ไม่มีงาน PK = 0
    for i in 1 .. cardinality(v_codes) loop
      if private.bom_fg_total(v_ord.id, v_codes[i], 'receive') + v_qtys[i] > private.bom_fg_pk_done(v_ord.id, v_codes[i]) then
        raise exception 'BOM_FG_EXCEEDS';
      end if;
    end loop;
  elsif v_kind = 'deliver' then
    if v_ord.status not in ('released', 'in_progress', 'completed') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    -- ส่งมอบสะสมของสินค้าหนึ่งเกินที่ใบนี้มี (have = own + in) หักที่ใบอื่นหยิบไป (out) ไม่ได้
    for i in 1 .. cardinality(v_codes) loop
      if private.bom_fg_total(v_ord.id, v_codes[i], 'deliver') + v_qtys[i]
         > private.bom_fg_have(v_ord.id, v_codes[i]) - private.bom_fg_out(v_ord.id, v_codes[i]) then
        raise exception 'BOM_FG_EXCEEDS';
      end if;
    end loop;
  else
    -- ปิดใบรับไม่ครบ: ใบยังเปิดอยู่ ทุกงาน PK เสร็จแล้ว ทุกสินค้ารับเข้าคลังเท่าที่ PK ทำได้ครบ (own) และอย่างน้อยหนึ่งสินค้า have น้อยกว่าที่สั่ง (ไม่เช่นนั้น BOM_INVALID_TRANSITION)
    if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if exists (select 1 from public.bom_jobs j where j.is_test and j.order_pk = v_ord.id and j.dept = 'PK' and j.status <> 'done') then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;
    for v_item in select value from jsonb_array_elements(v_ord.items) loop
      v_code := v_item ->> 'fgCode';
      v_received := private.bom_fg_total(v_ord.id, v_code, 'receive');
      if v_received <> private.bom_fg_pk_done(v_ord.id, v_code) then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if private.bom_fg_have(v_ord.id, v_code) < (v_item ->> 'qty')::numeric then v_short := true; end if;
    end loop;
    if not v_short then raise exception 'BOM_INVALID_TRANSITION'; end if;
  end if;

  -- เขียนประวัติ: หนึ่งแถวต่อบรรทัด (close: หนึ่งแถว รหัสว่าง qty 0 เหตุผลอยู่ใน note)
  if v_kind = 'close' then
    insert into public.bom_fg_moves (is_test, order_pk, fg_code, kind, qty, note, created_by)
    values (true, v_ord.id, '', 'close', 0, v_note, p_actor.id);
    v_n := 1;
    v_close := true;
  else
    for i in 1 .. cardinality(v_codes) loop
      insert into public.bom_fg_moves (is_test, order_pk, fg_code, kind, qty, note, created_by)
      values (true, v_ord.id, v_codes[i], v_kind, v_qtys[i], v_note, p_actor.id);
      v_n := v_n + 1;
    end loop;
    -- ใบที่ยังไม่ปิด: ทุกสินค้ามีครบ (have >= ที่สั่ง) = ปิดใบอัตโนมัติ · ใบที่ completed แล้วรับเพิ่มไม่เปลี่ยนใบ
    if v_kind = 'receive' and v_ord.status <> 'completed' and jsonb_array_length(v_ord.items) > 0 and not exists (
         select 1 from jsonb_array_elements(v_ord.items) it
         where private.bom_fg_have(v_ord.id, it ->> 'fgCode') < (it ->> 'qty')::numeric) then
      v_close := true;
    end if;
  end if;
  if v_close then
    update public.bom_orders set status = 'completed', completed_at = now(), updated_at = now() where id = v_ord.id;
  end if;
  return jsonb_build_object('moves', v_n, 'closed', v_close);
end;
$$;
revoke all on function private.bom_fg_move(public.employees, text, jsonb) from public, anon, authenticated;

-- 4. ใบสั่งผลิต: หยิบสต็อกตอนปล่อยผลิต · คีย์สินค้าของ stockCounts เป็นของกลุ่มวางแผน · คืนสต็อกตอนยกเลิก / เปิดกลับ
--    (นิยามจาก 20261121010000_bom_fg_receive_deliver.sql) -----------------------------------------------------------------------------------
create or replace function private.bom_save_orders(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rows jsonb, p_job_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_el jsonb;
  v_seen text[] := '{}';
  v_released uuid[] := '{}';
  v_cancelled text[] := '{}';
  v_reopened text[] := '{}';
  v_dept text := private.bom_dept_of(p_actor);
  v_pi text;
  v_customer text;
  v_country text;
  v_type text;
  v_ordered numeric;
  v_wh numeric;
  v_due jsonb;
  v_defaults jsonb;
  v_items jsonb;
  v_expl jsonb;
  v_counts jsonb;
  v_note text;
  v_status text;
  v_reason text;
  v_old public.bom_orders%rowtype;
  v_content boolean;
  v_counts_changed boolean;
  v_status_changed boolean;
  v_revision integer;
  v_reopen boolean;
  v_has_job boolean;
  v_release boolean;
  v_new_status text;
  v_full boolean;
  v_code text;
  v_qty numeric;
  v_take numeric;
  v_part numeric;
  v_src record;
  v_moves integer := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_ORDER'; end if;
    v_pi := upper(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_ORDER'));
    if v_pi ~ '[[:cntrl:]]' or v_pi = any (v_seen) then raise exception 'BOM_INVALID_ORDER'; end if;
    v_seen := v_seen || v_pi;
    -- ชื่อลูกค้าบนใบใช้การจัดรูปเดียวกับตาราง bom_customers (ช่องว่างซ้ำรวมเป็นช่องเดียว ตัดหัวท้าย) client ใช้กฎเดียวกันกับกุญแจ
    v_customer := btrim(regexp_replace(private.bom_text(v_row, 'customer', 120, 1, 'BOM_INVALID_ORDER'), '\s+', ' ', 'g'));
    v_country := private.bom_text(v_row, 'country', 60, 1, 'BOM_INVALID_ORDER');
    v_type := upper(private.bom_text(v_row, 'orderType', 2, 1, 'BOM_INVALID_ORDER'));
    if v_type not in ('SA', 'EX') then raise exception 'BOM_INVALID_ORDER'; end if;
    v_ordered := private.bom_num(v_row -> 'orderedAt', 'BOM_INVALID_ORDER', 1, 100000000000000);
    v_wh := private.bom_num(v_row -> 'whDue', 'BOM_INVALID_ORDER', 1, 100000000000000);
    if v_ordered is null or v_wh is null or v_ordered <> trunc(v_ordered) or v_wh <> trunc(v_wh) or v_wh < v_ordered then
      raise exception 'BOM_INVALID_ORDER';
    end if;
    v_due := private.bom_parse_due(v_row -> 'due');
    v_node := v_row -> 'dueDefaults';
    if v_node is null or jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
    if jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 10 then raise exception 'BOM_INVALID_ORDER'; end if;
    v_defaults := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'string' or (v_el #>> '{}') !~ '^[A-Z]{2}$' then raise exception 'BOM_INVALID_ORDER'; end if;
      v_defaults := v_defaults || jsonb_build_array(v_el);
    end loop;
    v_items := private.bom_parse_order_items(v_row -> 'items');
    v_expl := private.bom_parse_explosion(v_row -> 'explosion');
    v_counts := private.bom_parse_stock_counts(v_row -> 'stockCounts');
    v_note := private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_ORDER');
    v_reason := private.bom_text(v_row, 'cancelReason', 200, 0, 'BOM_INVALID_ORDER');
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_ORDER');
    if v_status not in ('draft', 'released', 'in_progress', 'completed', 'cancelled') then raise exception 'BOM_INVALID_ORDER'; end if;

    select * into v_old from public.bom_orders o where o.is_test and o.pi_no = v_pi;
    if not found then
      -- ใบใหม่: กลุ่มวางแผนเท่านั้น เริ่มที่ draft เสมอ (revision 0, ผู้สร้าง/เวลา เซิร์ฟเวอร์ตั้ง)
      if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
      if v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      insert into public.bom_orders (
        is_test, pi_no, customer, country, order_type, ordered_at, wh_due, due, due_defaults, revision, status, items, explosion,
        exploded_at, stock_counts, note, stock_counted_at, stock_counted_by, created_by)
      values (
        true, v_pi, v_customer, v_country, v_type, v_ordered::bigint, v_wh::bigint, v_due, v_defaults, 0, 'draft', v_items, v_expl,
        case when v_expl is null then null else now() end, v_counts, v_note,
        case when v_counts = '{}'::jsonb then null else now() end,
        case when v_counts = '{}'::jsonb then null else p_actor.id end, p_actor.id);
      continue;
    end if;

    v_content := v_old.customer <> v_customer or v_old.country <> v_country or v_old.order_type <> v_type
      or v_old.ordered_at <> v_ordered::bigint or v_old.wh_due <> v_wh::bigint or v_old.due <> v_due
      or v_old.due_defaults <> v_defaults or v_old.items <> v_items or v_old.explosion is distinct from v_expl or v_old.note <> v_note;
    v_counts_changed := v_old.stock_counts <> v_counts;
    v_status_changed := v_old.status <> v_status;
    -- สำเนาที่ตรงกับแถวล่าสุดทุกช่อง ไม่เขียนอะไร (ไม่ต้องตรวจชน: เช่นใบที่ผู้อื่นเพิ่งเปลี่ยนเป็น in_progress แล้วสำเนานี้ก็เป็น in_progress)
    if not (v_content or v_counts_changed or v_status_changed) then continue; end if;

    -- ใบเปลี่ยนเป็น completed ผ่านแถวใบสั่งผลิตไม่ได้เลย (ทุกชื่อ action ทุกผู้เรียก รวมกลุ่มวางแผนและ admin): ปิดใบได้ทางเดียวคือรับของสำเร็จรูปเข้าคลังครบ
    -- (ปิดอัตโนมัติ) หรือ closeOrderShort โดยแผนก WH / admin ผ่าน private.bom_fg_move · ตรวจก่อนชน/สิทธิ์เพื่อให้ได้ BOM_FORBIDDEN เหมือนกันทุกกรณี
    -- (ใบที่มาจากสต็อกทั้งหมดเป็น completed ตอนปล่อยผลิต: เซิร์ฟเวอร์ตั้งเองข้างล่าง client ส่ง released)
    if v_status_changed and v_status = 'completed' then raise exception 'BOM_FORBIDDEN'; end if;

    -- released -> in_progress เกิดเองเมื่องานเริ่ม (ตั้งตอนบันทึกงาน) ยอมรับเมื่อมาพร้อมงานของใบนี้ ข้ามไม่เขียน (ตัวเขียนงานตรวจชนของงานเอง)
    if v_status_changed and v_old.status = 'released' and v_status = 'in_progress' and not v_content and not v_counts_changed then
      v_has_job := exists (select 1 from jsonb_array_elements(p_job_rows) j where upper(btrim(coalesce(j.value ->> 'orderId', ''))) = v_pi);
      if not v_has_job then raise exception 'BOM_INVALID_TRANSITION'; end if;
      continue;
    end if;

    -- ชนก่อนสิทธิ์เสมอ: สำเนาที่ต่างจากแถวล่าสุดและแถวนั้นถูกคนอื่นแก้หลังเวอร์ชันฐาน = ฝั่ง client ถือสำเนาเก่า
    -- (เทียบสิทธิ์/เนื้อหากับแถวล่าสุดไม่ได้ ไม่งั้นสำเนาเก่าถูกมองเป็นการแก้ที่ไม่มีสิทธิ์) ให้ตามทันแล้วทำใหม่
    if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;

    -- สิทธิ์: กลุ่มวางแผนแก้ได้ทุกอย่าง · ST/WH แก้ได้เฉพาะ stockCounts ของใบ draft · คนอื่นแก้ไม่ได้
    if not p_planner then
      if v_content or v_status_changed or v_dept is null or v_dept not in ('ST', 'WH') then raise exception 'BOM_FORBIDDEN'; end if;
      -- คีย์ที่เป็นรหัสสินค้าของใบ (จำนวนที่หยิบจากสต็อกสินค้าสำเร็จรูป) ตั้งได้เฉพาะกลุ่มวางแผน · ST / WH นับชิ้นอื่นของใบได้เหมือนเดิม
      if v_counts_changed and exists (
           select 1 from jsonb_array_elements(v_old.items) it
           where (v_old.stock_counts -> (it ->> 'fgCode')) is distinct from (v_counts -> (it ->> 'fgCode'))) then
        raise exception 'BOM_FORBIDDEN';
      end if;
    end if;

    -- นับคงคลังได้เฉพาะใบ draft · ใบที่ไม่ใช่ draft แก้เนื้อหาไม่ได้ (เว้นแต่เปิดกลับเป็น draft)
    if v_counts_changed and v_old.status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if v_content and v_old.status <> 'draft' and v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;

    v_reopen := false;
    v_release := false;
    v_revision := v_old.revision;
    if v_status_changed then
      if v_old.status = 'draft' and v_status = 'released' then
        if jsonb_array_length(v_items) = 0 or v_expl is null then raise exception 'BOM_INVALID_TRANSITION'; end if;
        v_released := v_released || v_old.id;
        v_release := true;
      elsif v_old.status = 'draft' and v_status = 'cancelled' then
        null;
      elsif v_old.status in ('released', 'in_progress') and v_status = 'cancelled' then
        if exists (select 1 from public.bom_jobs j where j.is_test and j.order_pk = v_old.id and j.qty_done > 0) then
          raise exception 'BOM_INVALID_TRANSITION';
        end if;
        -- สต็อกสินค้าสำเร็จรูป: ส่งมอบแล้ว / ให้ใบอื่นไปแล้ว = BOM_INVALID_TRANSITION · ไม่เช่นนั้นคืนที่หยิบมา (untransfer)
        v_moves := v_moves + private.bom_fg_return_stock(v_old.id, p_actor.id);
        -- WO ที่ผูกงาน: planned / released ยกเลิกให้ · เลยจากนั้น = BOM_RF_ORDER_STARTED (ผิดข้อใด ทั้งคำสั่งไม่เขียนอะไร)
        v_cancelled := v_cancelled || private.bom_cancel_rf_orders(v_old.id);
        perform private.bom_delete_order_jobs(v_old.id);
      elsif v_old.status in ('released', 'in_progress') and v_status = 'draft' then
        -- เปิดใบกลับมาแก้ได้เมื่อไม่มีงานใดเริ่ม (ตรวจจากสถานะในฐานข้อมูล) งานทั้งหมดถูกลบ revision + 1 ยอดนับคงคลังคงอยู่
        if private.bom_started_jobs(v_old.id) then raise exception 'BOM_INVALID_TRANSITION'; end if;
        -- สต็อกสินค้าสำเร็จรูป: เหมือนยกเลิก (stockCounts คงอยู่ ปล่อยผลิตใหม่ก็หยิบใหม่)
        v_moves := v_moves + private.bom_fg_return_stock(v_old.id, p_actor.id);
        -- งานที่ผูก WO ที่เลย released ถูกนับว่าเริ่มแล้วข้างบน ที่เหลือ (WO planned / released) ยกเลิกให้ก่อนลบงาน
        v_reopened := v_reopened || private.bom_cancel_rf_orders(v_old.id);
        perform private.bom_delete_order_jobs(v_old.id);
        v_reopen := true;
        v_revision := v_old.revision + 1;
      else
        raise exception 'BOM_INVALID_TRANSITION';
      end if;
    end if;

    -- ปล่อยผลิต: หยิบสต็อกสินค้าสำเร็จรูปตาม stockCounts[รหัสสินค้า] = n > 0 · n เกินจำนวนสั่ง = BOM_INVALID_ORDER · สต็อกไม่พอ = BOM_FG_EXCEEDS
    -- (client ถือเป็นตัวเลขเก่า) · หยิบจากใบต้นทางที่ปล่อยผลิตก่อน (released_at แล้วเลข PI) หนึ่งแถว transfer ต่อใบต้นทาง
    -- ใบที่ปล่อยก่อนในคำสั่งเดียวกันหยิบก่อน (ลำดับแถว) · ทุกสินค้ามีครบจากสต็อก = ใบ completed ในคำสั่งนี้ (ไม่มีงานให้ทำ)
    v_new_status := v_status;
    if v_release then
      v_full := true;
      for v_el in select value from jsonb_array_elements(v_items) loop
        v_code := v_el ->> 'fgCode';
        v_qty := (v_el ->> 'qty')::numeric;
        v_take := coalesce((v_counts ->> v_code)::numeric, 0);
        if v_take > 0 then
          if v_take > v_qty then raise exception 'BOM_INVALID_ORDER'; end if;
          if private.bom_fg_stock(v_code) < v_take then raise exception 'BOM_FG_EXCEEDS'; end if;
          for v_src in
            select o.id, private.bom_fg_free(o.id, v_code) as avail
            from public.bom_orders o
            where o.is_test and o.id <> v_old.id and o.status in ('released', 'in_progress', 'completed')
              and exists (select 1 from public.bom_fg_moves m where m.is_test and m.order_pk = o.id and m.fg_code = v_code)
            order by o.released_at, o.pi_no collate "C"
          loop
            exit when v_take <= 0;
            continue when v_src.avail <= 0;
            v_part := least(v_take, v_src.avail);
            insert into public.bom_fg_moves (is_test, order_pk, from_order_pk, fg_code, kind, qty, note, created_by)
            values (true, v_old.id, v_src.id, v_code, 'transfer', v_part, '', p_actor.id);
            v_take := v_take - v_part;
            v_moves := v_moves + 1;
          end loop;
          if v_take > 0 then raise exception 'BOM_FG_EXCEEDS'; end if;
        end if;
        if private.bom_fg_have(v_old.id, v_code) < v_qty then v_full := false; end if;
      end loop;
      if v_full then v_new_status := 'completed'; end if;
    end if;

    update public.bom_orders set
      customer = v_customer, country = v_country, order_type = v_type, ordered_at = v_ordered::bigint, wh_due = v_wh::bigint,
      due = v_due, due_defaults = v_defaults, items = v_items, explosion = v_expl,
      exploded_at = case when v_reopen or v_expl is null then null
                         when v_old.explosion is distinct from v_expl or v_old.exploded_at is null then now()
                         else v_old.exploded_at end,
      stock_counts = v_counts,
      stock_counted_at = case when v_counts_changed then now() else v_old.stock_counted_at end,
      stock_counted_by = case when v_counts_changed then p_actor.id else v_old.stock_counted_by end,
      note = v_note, status = v_new_status, revision = v_revision,
      released_at = case when v_status = 'released' and v_status_changed then now() when v_reopen then null else v_old.released_at end,
      released_by = case when v_status = 'released' and v_status_changed then p_actor.id when v_reopen then null else v_old.released_by end,
      completed_at = case when v_new_status = 'completed' and v_status_changed then now() else v_old.completed_at end,
      cancelled_at = case when v_status = 'cancelled' and v_status_changed then now() else v_old.cancelled_at end,
      cancel_reason = case when v_status = 'cancelled' and v_status_changed then v_reason else v_old.cancel_reason end,
      updated_at = now()
    where id = v_old.id;
  end loop;
  return jsonb_build_object('released', to_jsonb(v_released), 'cancelled', to_jsonb(v_cancelled), 'reopened', to_jsonb(v_reopened),
                            'fgMoves', v_moves);
end;
$$;
revoke all on function private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) from public, anon, authenticated;

-- 5. snapshot / delta: fgMoves ชนิด transfer / untransfer มี fromOrderId (นิยามจาก 20261121010000_bom_fg_receive_deliver.sql เปลี่ยนเฉพาะชุด fgMoves) -------------
-- fgMoves = ประวัติรับ/ส่งมอบ/ปิดใบ/หยิบ-คืนสต็อก เรียงตามเวลาแล้ว id · ชุด delete เป็น [] เสมอ (ไม่มีการลบ) · ยอดรับ/ส่งมอบสะสม สต็อก และสถานะ "ส่งมอบแล้ว" client คำนวณจากชุดนี้กับใบ/งาน
create or replace function private.bom_records(p_since bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'code', i.code, 'kind', i.kind, 'name', i.name, 'ownerDept', i.owner_dept, 'uom', i.uom,
          'weightG', i.weight_g, 'rubber', i.rubber, 'legacyCodes', i.legacy_codes, 'active', i.active,
          'group', i.item_group, 'createdAt', private.bom_ms(i.created_at), 'updatedAt', private.bom_ms(i.updated_at))
        || case when i.unit_cost is null then '{}'::jsonb else jsonb_build_object('unitCost', i.unit_cost) end
        || case when i.image is null then '{}'::jsonb else jsonb_build_object('image', i.image) end
        || case when i.imported_from is null then '{}'::jsonb else jsonb_build_object('importedFrom', i.imported_from) end
        || case when i.cloned_from is null then '{}'::jsonb else jsonb_build_object('clonedFrom', i.cloned_from) end
        order by i.code collate "C")
      from public.bom_items i where i.is_test and i.changed_version > p_since), '[]'::jsonb),
    'compounds', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', c.code, 'name', c.name, 'recipeId', c.recipe_id, 'recipeName', c.recipe_name,
          'createdAt', private.bom_ms(c.created_at)) order by c.code collate "C")
      from public.bom_compounds c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
    'colors', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', c.code, 'master', substr(c.code, 1, 2), 'shade', substr(c.code, 3, 2), 'name', c.name,
          'createdAt', private.bom_ms(c.created_at)) order by c.code collate "C")
      from public.bom_colors c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
    'colorSets', coalesce((
      select jsonb_agg(jsonb_build_object(
          'base', s.base, 'code', s.code, 'name', s.name, 'note', s.note, 'slots', s.slots,
          'createdAt', private.bom_ms(s.created_at), 'createdBy', coalesce(private.bom_person(s.created_by), ''),
          'updatedAt', private.bom_ms(s.updated_at), 'updatedBy', coalesce(private.bom_person(s.updated_by), ''))
        order by s.base collate "C", s.code collate "C")
      from public.bom_color_sets s where s.is_test and s.changed_version > p_since), '[]'::jsonb),
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
          'base', p.base, 'code', p.code, 'name', p.name, 'lines', p.lines,
          'createdAt', private.bom_ms(p.created_at), 'createdBy', coalesce(private.bom_person(p.created_by), ''),
          'updatedAt', private.bom_ms(p.updated_at), 'updatedBy', coalesce(private.bom_person(p.updated_by), ''))
        order by p.base collate "C", p.code collate "C")
      from public.bom_packages p where p.is_test and p.changed_version > p_since), '[]'::jsonb),
    'boms', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.bom_id, 'itemCode', b.item_code, 'revision', b.revision, 'status', b.status, 'ownerDept', b.owner_dept,
          'lines', private.bom_lines_json(b.id), 'createdBy', coalesce(private.bom_person(b.created_by), ''),
          'createdAt', private.bom_ms(b.created_at), 'approvedBy', coalesce(private.bom_person(b.approved_by), ''),
          'approvedAt', private.bom_ms(b.approved_at), 'note', b.note, 'changeLog', b.change_log)
        || case when b.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(b.superseded_at)) end
        order by b.bom_id collate "C")
      from public.bom_boms b where b.is_test and b.changed_version > p_since), '[]'::jsonb),
    'processes', coalesce((
      select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'dept', p.dept) order by p.code collate "C")
      from public.bom_processes p where p.is_test and p.changed_version > p_since), '[]'::jsonb),
    'routings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.routing_id, 'itemCode', r.item_code, 'revision', r.revision, 'status', r.status, 'steps', r.steps,
          'createdBy', coalesce(private.bom_person(r.created_by), ''), 'createdAt', private.bom_ms(r.created_at))
        || case when r.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(r.superseded_at)) end
        order by r.routing_id collate "C")
      from public.bom_routings r where r.is_test and r.changed_version > p_since), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'name', c.name, 'country', c.country, 'orderType', c.order_type, 'note', c.note,
          'createdAt', private.bom_ms(c.created_at)) order by lower(c.name) collate "C", c.name collate "C")
      from public.bom_customers c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.pi_no, 'customer', o.customer, 'country', o.country, 'orderType', o.order_type,
          'orderedAt', o.ordered_at, 'whDue', o.wh_due, 'due', o.due, 'dueDefaults', o.due_defaults,
          'revision', o.revision, 'status', o.status, 'items', o.items, 'explosion', o.explosion,
          'explodedAt', private.bom_ms(o.exploded_at), 'stockCounts', o.stock_counts, 'note', o.note,
          'createdBy', coalesce(private.bom_person(o.created_by), ''), 'createdAt', private.bom_ms(o.created_at))
        || case when o.stock_counted_at is null then '{}'::jsonb
                else jsonb_build_object('stockCountedAt', private.bom_ms(o.stock_counted_at),
                                        'stockCountedBy', coalesce(private.bom_person(o.stock_counted_by), '')) end
        || case when o.released_at is null then '{}'::jsonb
                else jsonb_build_object('releasedAt', private.bom_ms(o.released_at),
                                        'releasedBy', coalesce(private.bom_person(o.released_by), '')) end
        || case when o.completed_at is null then '{}'::jsonb else jsonb_build_object('completedAt', private.bom_ms(o.completed_at)) end
        || case when o.cancelled_at is null then '{}'::jsonb
                else jsonb_build_object('cancelledAt', private.bom_ms(o.cancelled_at), 'cancelReason', o.cancel_reason) end
        order by o.ordered_at desc, o.pi_no collate "C")
      from public.bom_orders o where o.is_test and o.changed_version > p_since), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', j.job_no, 'orderId', o.pi_no, 'dept', j.dept, 'itemCode', j.item_code, 'name', j.name, 'kind', j.kind, 'uom', j.uom,
          'qtyPlanned', j.qty_planned, 'qtyRequired', j.qty_required, 'stockCounted', j.stock_counted,
          'qtyDone', j.qty_done, 'qtyReject', j.qty_reject, 'dueAt', j.due_at, 'status', j.status,
          'externalRef', j.external_ref, 'fgCodes', j.fg_codes, 'reports', j.reports, 'createdAt', private.bom_ms(j.created_at))
        || case when j.done_at is null then '{}'::jsonb else jsonb_build_object('doneAt', private.bom_ms(j.done_at)) end
        order by o.pi_no collate "C", j.dept collate "C", j.item_code collate "C", j.job_no collate "C")
      from public.bom_jobs j join public.bom_orders o on o.id = j.order_pk
      where j.is_test and j.changed_version > p_since), '[]'::jsonb),
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object(
          'itemCode', s.item_code, 'qty', s.qty, 'safetyQty', s.safety_qty, 'countedAt', private.bom_ms(s.counted_at),
          'countedBy', coalesce(private.bom_person(s.counted_by), ''), 'updatedAt', private.bom_ms(s.updated_at))
        order by s.item_code collate "C")
      from public.bom_stock s where s.is_test and s.changed_version > p_since), '[]'::jsonb),
    'stockMoves', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id::text, 'itemCode', m.item_code, 'kind', m.kind, 'qty', m.qty, 'balance', m.balance, 'ref', m.ref,
          'at', private.bom_ms(m.created_at), 'by', coalesce(private.bom_person(m.created_by), ''), 'note', m.note)
        order by m.created_at, m.id)
      from public.bom_stock_moves m where m.is_test and m.changed_version > p_since), '[]'::jsonb),
    'fgMoves', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id::text, 'orderId', o.pi_no, 'fgCode', m.fg_code, 'kind', m.kind, 'qty', m.qty, 'note', m.note,
          'at', private.bom_ms(m.created_at), 'by', coalesce(private.bom_person(m.created_by), ''))
        -- transfer / untransfer เท่านั้นที่มีใบต้นทาง (constraint ของตาราง) · ชนิดอื่นคงรูปเดิม 8 ช่อง
        || case when m.from_order_pk is null then '{}'::jsonb else jsonb_build_object('fromOrderId', s.pi_no) end
        order by m.created_at, m.id)
      from public.bom_fg_moves m join public.bom_orders o on o.id = m.order_pk
      left join public.bom_orders s on s.id = m.from_order_pk
      where m.is_test and m.changed_version > p_since), '[]'::jsonb))
$$;
revoke all on function private.bom_records(bigint) from public, anon, authenticated;

-- 6. RPC: บันทึกชุดการเปลี่ยนแปลง (นิยามจาก 20261122010000_bom_fg_guards.sql: นับ transfer / untransfer ของตัวเขียนใบใน audit
--    และใบที่ completed ตอนปล่อยผลิตจากสต็อกไม่ต้องมีงาน) ----------------------------------------------------------------------------------
create or replace function public.app_bom_save_master(
  p_changes jsonb, p_base_version bigint, p_action text, p_audit jsonb default '[]'::jsonb, p_epoch text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_actor_name text;
  v_planner boolean;
  v_sections constant text[] := array['items', 'compounds', 'colors', 'colorSets', 'packages', 'boms', 'processes', 'routings',
                                      'customers', 'orders', 'jobs', 'stock', 'partReturns', 'fgMoves'];
  -- ส่วนที่เขียนได้เฉพาะกลุ่มวางแผน (orders / jobs ตรวจรายช่องในตัวเขียน)
  v_planner_sections constant text[] := array['items', 'compounds', 'colors', 'colorSets', 'packages', 'boms', 'processes', 'routings',
                                              'customers'];
  v_key text;
  v_sub text;
  v_sec jsonb;
  v_node jsonb;
  v_n integer;
  v_total integer := 0;
  v_counts jsonb := '{}'::jsonb;
  v_audit jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_version bigint;
  v_epoch uuid;
  v_row jsonb;
  v_dbase text;
  v_dcode text;
  v_row_version bigint;
  v_item_codes text[] := '{}';
  v_roots text[] := '{}';
  v_touched text[];
  v_released uuid[] := '{}';
  v_started uuid[] := '{}';
  v_bad text;
  v_res jsonb;
  v_oid uuid;
  v_delta jsonb;
  v_rf_opened jsonb := '[]'::jsonb;
  v_rf_skipped jsonb := '[]'::jsonb;
  v_rf_cancelled jsonb := '[]'::jsonb;
  v_rf_n integer;
  v_rf_cancel_n integer := 0;
  v_rf_reopen_n integer := 0;
  v_rf_version bigint;
  v_rf_meta jsonb := '{}'::jsonb;
  v_stock_n integer;
  v_fg jsonb;
  v_fg_orders_n integer;
begin
  perform private.lab_only_block();
  -- ล็อกเดียวกับ app_rf_save (ธุรกรรมละหนึ่งตัว ปล่อยเมื่อจบ): ฟังก์ชันนี้ล็อก BOM ก่อนแล้วเปิด/ยกเลิก WO ใน RF ส่วน app_rf_save ล็อก RF ก่อนแล้ว BOM ถ้าไม่มีล็อกนี้จะวนกันได้
  perform pg_advisory_xact_lock(hashtext('mnp_bom_rf_master'));
  v_actor := private.bom_actor();
  v_planner := private.bom_can_edit(v_actor);
  -- ด่านหยาบ: คนนอกกลุ่มวางแผนเรียกได้เฉพาะ action ของนับคงคลัง/รายงานงาน (สิทธิ์จริงตรวจรายส่วนและรายช่องข้างล่าง)
  if not v_planner and (p_action is null or not (p_action = any (private.bom_staff_actions()))) then raise exception 'BOM_FORBIDDEN'; end if;
  if p_action is null or not (p_action = any (private.bom_client_actions())) then raise exception 'BOM_INVALID_ACTION'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_base_version is null or p_base_version < 0 then
    raise exception 'BOM_INVALID_PAYLOAD';
  end if;

  -- audit ของ client: [{action, detail}] ไม่เกิน 20 รายการ
  if p_audit is not null and jsonb_typeof(p_audit) <> 'null' then
    if jsonb_typeof(p_audit) <> 'array' or jsonb_array_length(p_audit) > 20 then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    for v_entry in select value from jsonb_array_elements(p_audit) loop
      if jsonb_typeof(v_entry) <> 'object' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
      v_audit := v_audit || jsonb_build_array(jsonb_build_object(
        'action', private.bom_text(v_entry, 'action', 80, 1, 'BOM_INVALID_PAYLOAD'),
        'detail', private.bom_text(v_entry, 'detail', 300, 0, 'BOM_INVALID_PAYLOAD')));
    end loop;
  end if;

  -- รูปของ payload: ส่วนที่รู้จัก, upsert (ทุกส่วน) / delete (เฉพาะ colorSets, packages และ jobs), เป็นอาร์เรย์ไม่เกิน 5,000 เรคอร์ดต่อส่วน
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (v_sections)) then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    v_sec := p_changes -> v_key;
    if jsonb_typeof(v_sec) <> 'object' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    for v_sub in select jsonb_object_keys(v_sec) loop
      if not (v_sub = 'upsert' or (v_sub = 'delete' and v_key in ('colorSets', 'packages', 'jobs'))) then
        raise exception 'BOM_INVALID_PAYLOAD';
      end if;
      v_node := v_sec -> v_sub;
      if jsonb_typeof(v_node) <> 'array' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
      v_n := jsonb_array_length(v_node);
      if v_n > 5000 then raise exception 'BOM_TOO_MANY'; end if;
      -- ของสำเร็จรูป: ส่วน fgMoves ส่งได้เฉพาะ receiveFg / deliverFg / closeOrderShort และสามการกระทำนี้ส่งได้เฉพาะส่วน fgMoves (ผิด = BOM_INVALID_FG ตรวจก่อนกฎของส่วนอื่น)
      if v_n > 0 and ((v_key = 'fgMoves' and not (p_action in ('receiveFg', 'deliverFg', 'closeOrderShort')))
                      or (p_action in ('receiveFg', 'deliverFg', 'closeOrderShort') and v_key <> 'fgMoves')) then
        raise exception 'BOM_INVALID_FG';
      end if;
      -- สต็อกของซื้อ: ส่วน stock ส่งได้เฉพาะ countPartStock และ countPartStock ส่งได้เฉพาะส่วน stock · issueOrderParts ส่งได้เฉพาะงาน (jobs upsert)
      -- คืนของซื้อ: ส่วน partReturns ส่งได้เฉพาะ undoOrderParts / returnOrderParts และสองการกระทำนี้ส่งได้เฉพาะส่วน partReturns
      if v_n > 0 and ((v_key = 'stock' and p_action <> 'countPartStock')
                      or (p_action = 'countPartStock' and v_key <> 'stock')
                      or (p_action = 'issueOrderParts' and not (v_key = 'jobs' and v_sub = 'upsert'))
                      or (v_key = 'partReturns' and p_action not in ('undoOrderParts', 'returnOrderParts'))
                      or (p_action in ('undoOrderParts', 'returnOrderParts') and v_key <> 'partReturns')) then
        raise exception 'BOM_INVALID_PAYLOAD';
      end if;
      -- ข้อมูลหลักและลูกค้าเขียนได้เฉพาะกลุ่มวางแผน
      if v_n > 0 and v_key = any (v_planner_sections) and not v_planner then raise exception 'BOM_FORBIDDEN'; end if;
      v_total := v_total + v_n;
      v_counts := v_counts || jsonb_build_object(v_key, coalesce(v_counts -> v_key, '{}'::jsonb) || jsonb_build_object(v_sub, v_n));
    end loop;
  end loop;

  -- ของสำเร็จรูป: receiveFg / deliverFg / closeOrderShort ต้องมีคำขอในส่วน fgMoves เสมอ (ไม่มีส่วนนี้ หรือ upsert ว่าง = BOM_INVALID_FG
  -- ไม่ใช่สำเร็จแบบไม่ทำอะไร) ตามสัญญา "คำขอเดียวต่อคำสั่ง" · ตรวจหลังรูป payload ก่อนล็อกตัวนับ (BOM_RESET / ฐานเวอร์ชันมาทีหลัง)
  if p_action in ('receiveFg', 'deliverFg', 'closeOrderShort') and coalesce(jsonb_array_length(p_changes #> '{fgMoves,upsert}'), 0) = 0 then
    raise exception 'BOM_INVALID_FG';
  end if;

  -- ล็อกตัวนับก่อนตรวจชน: บันทึกพร้อมกันต่อคิวกัน คนที่สองเห็นเวอร์ชันของระเบียนที่คนแรกเพิ่งแก้ (changed_version) แล้วได้ BOM_STALE เฉพาะที่ชนกัน
  -- v_version = เวอร์ชันก่อนบันทึกนี้ (p_cur ของตัวเขียน) ระเบียนที่แก้ในคำสั่งนี้ได้ v_version + 1 จึงไม่ถูกนับว่าเป็นของคนอื่น
  insert into public.bom_master_state (is_test) values (true) on conflict (is_test) do nothing;
  select s.version, s.epoch into v_version, v_epoch from public.bom_master_state s where s.is_test for update;
  -- client ถือข้อมูลของรอบก่อนล้างข้อมูลทดสอบ: ไม่เขียนอะไร (ระเบียนที่มันถืออยู่ไม่มีแล้ว การบันทึกจะสร้างระเบียนที่ถูกล้างกลับมา)
  if p_epoch is not null and p_epoch <> v_epoch::text then raise exception 'BOM_RESET'; end if;
  if p_base_version > v_version then raise exception 'BOM_INVALID_PAYLOAD'; end if;
  if v_total = 0 then return private.bom_delta(p_base_version); end if;

  v_actor_name := v_actor.first_name || ' ' || v_actor.last_name;

  begin
    perform private.bom_save_compounds(v_actor.id, coalesce(p_changes #> '{compounds,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_colors(v_actor.id, coalesce(p_changes #> '{colors,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_processes(v_actor.id, coalesce(p_changes #> '{processes,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_item_codes := private.bom_save_items(v_actor.id, coalesce(p_changes #> '{items,upsert}', '[]'::jsonb), p_base_version, v_version);

    -- ลบก่อนเขียน (ลบแล้วสร้างใหม่รหัสเดิมในคำสั่งเดียวกันได้) ไม่พบ = BOM_NOT_FOUND แต่ถ้าคนอื่นเพิ่งลบหลังเวอร์ชันฐาน = BOM_STALE
    -- แถวที่คนอื่นแก้หลังเวอร์ชันฐานลบไม่ได้ (BOM_STALE) · ที่ลบแล้วจดหลุมฝังศพไว้ให้ delta
    for v_row in select value from jsonb_array_elements(coalesce(p_changes #> '{colorSets,delete}', '[]'::jsonb)) loop
      if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_COLOR_SET'; end if;
      v_dbase := private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_COLOR_SET'));
      v_dcode := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_COLOR_SET'));
      select s.changed_version into v_row_version from public.bom_color_sets s where s.is_test and s.base = v_dbase and s.code = v_dcode;
      if not found then
        if exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'colorSets' and k.base = v_dbase and k.code = v_dcode
                   and k.changed_version > p_base_version and k.changed_version <= v_version) then
          raise exception 'BOM_STALE';
        end if;
        raise exception 'BOM_NOT_FOUND';
      end if;
      if v_row_version > p_base_version and v_row_version <= v_version then raise exception 'BOM_STALE'; end if;
      delete from public.bom_color_sets where is_test and base = v_dbase and code = v_dcode;
      insert into public.bom_deleted_keys (is_test, list, base, code) values (true, 'colorSets', v_dbase, v_dcode)
      on conflict (list, base, code, is_test) do update set deleted_at = now();
    end loop;
    for v_row in select value from jsonb_array_elements(coalesce(p_changes #> '{packages,delete}', '[]'::jsonb)) loop
      if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_PACKAGE'; end if;
      v_dbase := private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_PACKAGE'));
      v_dcode := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_PACKAGE'));
      select p.changed_version into v_row_version from public.bom_packages p where p.is_test and p.base = v_dbase and p.code = v_dcode;
      if not found then
        if exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'packages' and k.base = v_dbase and k.code = v_dcode
                   and k.changed_version > p_base_version and k.changed_version <= v_version) then
          raise exception 'BOM_STALE';
        end if;
        raise exception 'BOM_NOT_FOUND';
      end if;
      if v_row_version > p_base_version and v_row_version <= v_version then raise exception 'BOM_STALE'; end if;
      delete from public.bom_packages where is_test and base = v_dbase and code = v_dcode;
      insert into public.bom_deleted_keys (is_test, list, base, code) values (true, 'packages', v_dbase, v_dcode)
      on conflict (list, base, code, is_test) do update set deleted_at = now();
    end loop;

    perform private.bom_save_color_sets(v_actor.id, coalesce(p_changes #> '{colorSets,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_packages(v_actor.id, coalesce(p_changes #> '{packages,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_roots := private.bom_save_boms(v_actor.id, v_actor_name, coalesce(p_changes #> '{boms,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_routings(v_actor.id, coalesce(p_changes #> '{routings,upsert}', '[]'::jsonb), p_base_version, v_version);

    -- ลูกค้า → ใบสั่งผลิต (รวมเปลี่ยนสถานะ ลบงานของใบที่ยกเลิก/เปิดกลับมาแก้) → ลบงานตรง ๆ → งาน (เพิ่ม/แก้) ตามลำดับนี้เสมอ
    perform private.bom_save_customers(v_actor.id, coalesce(p_changes #> '{customers,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_res := private.bom_save_orders(v_actor, v_actor_name, v_planner, coalesce(p_changes #> '{orders,upsert}', '[]'::jsonb),
                                     coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_released := array(select t.value::uuid from jsonb_array_elements_text(v_res -> 'released') as t(value));
    v_rf_cancel_n := jsonb_array_length(v_res -> 'cancelled');
    v_rf_reopen_n := jsonb_array_length(v_res -> 'reopened');
    v_rf_cancelled := (v_res -> 'cancelled') || (v_res -> 'reopened');
    -- สต็อกสินค้าสำเร็จรูป: แถว transfer (ปล่อยผลิต) / untransfer (ยกเลิก / เปิดกลับ) ที่ตัวเขียนใบเขียนเอง นับเป็น fgMoves (ส่วน fgMoves ไม่มากับ action ของใบ)
    v_fg_orders_n := coalesce((v_res ->> 'fgMoves')::integer, 0);
    if v_fg_orders_n > 0 then v_counts := v_counts || jsonb_build_object('fgMoves', jsonb_build_object('upsert', v_fg_orders_n)); end if;
    perform private.bom_delete_jobs(v_planner, coalesce(p_changes #> '{jobs,delete}', '[]'::jsonb), p_base_version, v_version);
    v_started := private.bom_save_jobs(v_actor, v_actor_name, v_planner, p_action, coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb),
                                       v_released, p_base_version, v_version);
    -- สต็อกของซื้อ: นับ (countPartStock) / เบิกจ่ายรายใบ (issueOrderParts: ตัวเขียนงานตรวจชนและข้ามแถวผลงานของงานของซื้อมาแล้ว) ทั้งสองอยู่ในธุรกรรมเดียวกับงาน
    perform private.bom_save_stock(v_actor, v_planner, coalesce(p_changes #> '{stock,upsert}', '[]'::jsonb), p_base_version, v_version);
    if p_action = 'issueOrderParts' then
      v_stock_n := private.bom_issue_parts(v_actor, v_planner, coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb), p_base_version, v_version);
      v_counts := v_counts || jsonb_build_object('stock', jsonb_build_object('upsert', v_stock_n));
    end if;
    -- คืนของซื้อ (undoOrderParts / returnOrderParts): ผลทั้งหมดคำนวณที่เซิร์ฟเวอร์ (งานที่กลับไปรอเบิกจ่าย สต็อก ประวัติ) · นับเป็น stock ตามจำนวนประวัติที่เขียน
    if p_action in ('undoOrderParts', 'returnOrderParts') then
      v_stock_n := private.bom_return_parts(v_actor, v_actor_name, v_planner, coalesce(p_changes #> '{partReturns,upsert}', '[]'::jsonb), p_base_version, v_version);
      if v_stock_n > 0 then v_counts := v_counts || jsonb_build_object('stock', jsonb_build_object('upsert', v_stock_n)); end if;
    end if;
    -- ของสำเร็จรูป (receiveFg / deliverFg / closeOrderShort): ผลทั้งหมดคำนวณที่เซิร์ฟเวอร์ (ประวัติ และใบที่ปิดเอง) · audit นับเป็น fgMoves ตามจำนวนแถวประวัติที่เขียน และ orders +1 เมื่อใบถูกปิด
    if p_action in ('receiveFg', 'deliverFg', 'closeOrderShort') then
      v_fg := private.bom_fg_move(v_actor, p_action, coalesce(p_changes #> '{fgMoves,upsert}', '[]'::jsonb));
      v_counts := v_counts || jsonb_build_object('fgMoves', jsonb_build_object('upsert', (v_fg ->> 'moves')::integer));
      if (v_fg ->> 'closed')::boolean then v_counts := v_counts || jsonb_build_object('orders', jsonb_build_object('upsert', 1)); end if;
    end if;
    if cardinality(v_started) > 0 then
      update public.bom_orders set status = 'in_progress', updated_at = now() where is_test and status = 'released' and id = any (v_started);
    end if;
    -- ใบที่ปล่อยผลิตต้องมีงาน (ปล่อยผลิตโดยไม่มีงานเลยไม่ได้) · ยกเว้นใบที่มาจากสต็อกสินค้าสำเร็จรูปทั้งหมด (completed ในคำสั่งนี้ ไม่มีอะไรให้ผลิต)
    if exists (select 1 from unnest(v_released) r(id) join public.bom_orders o on o.id = r.id
               where o.status <> 'completed' and not exists (select 1 from public.bom_jobs j where j.order_pk = r.id)) then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;
    -- เปิด WO ใน RubberFlow ให้งาน RB ของใบที่เพิ่งปล่อยผลิต (เปิดไม่ได้ = ข้ามพร้อมเหตุผล ไม่ทำให้การปล่อยล้ม)
    foreach v_oid in array v_released loop
      v_res := private.bom_open_rf_orders(v_actor, v_actor_name, v_oid);
      v_rf_opened := v_rf_opened || (v_res -> 'opened');
      v_rf_skipped := v_rf_skipped || (v_res -> 'skipped');
    end loop;

    -- ตรวจกฎ BOM หลังเขียนเฉพาะส่วนที่เกี่ยว: BOM ที่ approved ของชิ้นที่ถูกแก้/มี revision ใหม่ และ BOM ที่ใช้ชิ้นที่ถูกแก้เป็นลูก
    v_touched := v_item_codes || v_roots;
    if cardinality(v_touched) > 0 then
      -- ชนิดพ่อ/ลูก (rules.childKindError)
      select case when p.kind in ('PURCHASED', 'CP') then 'BOM_INVALID_PARENT_KIND' else 'BOM_INVALID_CHILD_KIND' end
      into v_bad
      from public.bom_boms b
      join public.bom_items p on p.is_test and p.code = b.item_code
      join public.bom_bom_lines l on l.bom_pk = b.id
      join public.bom_items c on c.is_test and c.code = l.child_code
      where b.is_test and b.status = 'approved'
        and (b.item_code = any (v_touched) or l.child_code = any (v_touched))
        and (p.kind in ('PURCHASED', 'CP')
             or (p.kind = 'RB' and c.kind <> 'CP')
             or (c.kind = 'CP' and p.kind <> 'RB'))
      limit 1;
      if v_bad is not null then raise exception '%', v_bad; end if;

      -- เส้นยาง: บรรทัดสูตรยางได้บรรทัดเดียว และต้องตรงกับ rubber.compound ของชิ้น (ถ้าระบุ)
      select case when x.n <> 1 then 'BOM_RB_ONE_COMPOUND' else 'BOM_RB_COMPOUND_MISMATCH' end
      into v_bad
      from public.bom_boms b
      join public.bom_items p on p.is_test and p.code = b.item_code and p.kind = 'RB'
      cross join lateral (
        select count(*) as n, min(l.child_code) as child
        from public.bom_bom_lines l where l.bom_pk = b.id) x
      where b.is_test and b.status = 'approved' and b.item_code = any (v_touched)
        and (x.n <> 1
             or (coalesce(p.rubber ->> 'compound', '') <> '' and private.bom_code(p.rubber ->> 'compound') <> x.child))
      limit 1;
      if v_bad is not null then raise exception '%', v_bad; end if;
    end if;

    -- วงจร: เดินจากพ่อของ revision ใหม่ลงไปตาม BOM ที่ approved (วงจรใหม่เกิดจากเส้นใหม่เท่านั้น) เพดาน 30 ชั้น
    if cardinality(v_roots) > 0 then
      with recursive walk(code, path) as (
        select l.child_code, array[r.root, l.child_code]
        from unnest(v_roots) as r(root)
        join public.bom_boms b on b.is_test and b.status = 'approved' and b.item_code = r.root
        join public.bom_bom_lines l on l.bom_pk = b.id
        union all
        select l.child_code, w.path || l.child_code
        from walk w
        join public.bom_boms b on b.is_test and b.status = 'approved' and b.item_code = w.code
        join public.bom_bom_lines l on l.bom_pk = b.id
        where cardinality(w.path) < 30
          and not (w.code = any (w.path[1:cardinality(w.path) - 1]))
      )
      select case
               when bool_or(w.code = any (w.path[1:cardinality(w.path) - 1])) then 'BOM_CYCLE'
               when max(cardinality(w.path)) >= 30 then 'BOM_TOO_DEEP'
             end
      into v_bad
      from walk w;
      if v_bad is not null then raise exception '%', v_bad; end if;
    end if;
  exception
    when unique_violation then
      raise exception 'BOM_CONFLICT';
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
      or numeric_value_out_of_range or string_data_right_truncation or datetime_field_overflow then
      -- ข้อความกลาง ๆ ไม่คืนค่าหรือชื่อ constraint กลับไป
      raise exception 'BOM_INVALID_DATA';
  end;

  -- WO ที่เปิด/ยกเลิกในคำสั่งนี้: เพิ่ม version ของ RF อีก 1 ครั้งเดียว (แถวถูก trigger rf_stamp_version ประทับ version + 1 แล้ว) และเขียน audit ของ RF ให้ app_rf_master_since / หน้า audit เห็น
  -- ล็อกแถวตัวนับ RF ถูกถือแล้ว (bom_lock_rf ตอนเขียน WO) ไม่มี WO ที่เปิด/ยกเลิก = ไม่แตะ RF เลย
  v_rf_n := jsonb_array_length(v_rf_opened) + jsonb_array_length(v_rf_cancelled);
  if v_rf_n > 0 then
    update public.rf_master_state set version = version + 1, updated_at = now(), updated_by = v_actor.id where is_test returning version into v_rf_version;
    -- แถว audit ละชนิด (ปล่อยผลิต / ยกเลิกใบ / เปิดใบกลับเป็นร่าง) ใช้ version ใหม่ตัวเดียวกัน
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    select private.bom_audit_actor_id(), 'RF_SAVE', 'rf_master', v_rf_version::text,
           jsonb_build_object('client_action', k.action, 'version', v_rf_version, 'base_version', v_rf_version - 1,
                              'counts', jsonb_build_object('orders', jsonb_build_object('upsert', k.n)),
                              'is_test', true, 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                              'entries', '[]'::jsonb)
    from (values (1, 'bom:releaseOrder', jsonb_array_length(v_rf_opened)), (2, 'bom:cancelOrder', v_rf_cancel_n), (3, 'bom:reopenOrder', v_rf_reopen_n)) as k(ord, action, n)
    where k.n > 0
    order by k.ord;
  end if;
  if v_rf_n > 0 or jsonb_array_length(v_rf_skipped) > 0 then
    v_rf_meta := jsonb_build_object('rubberflow', jsonb_build_object(
      'opened', jsonb_array_length(v_rf_opened), 'skipped', jsonb_array_length(v_rf_skipped), 'cancelled', jsonb_array_length(v_rf_cancelled)));
  end if;

  v_version := v_version + 1;
  update public.bom_master_state set version = v_version, updated_at = now(), updated_by = v_actor.id where is_test;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.bom_audit_actor_id(), 'BOM_MASTER_SAVE', 'bom_master', v_version::text,
          jsonb_build_object('client_action', p_action, 'version', v_version, 'base_version', p_base_version, 'counts', v_counts,
                             'is_test', true, 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                             'entries', v_audit) || v_rf_meta);
  v_delta := private.bom_delta(p_base_version);
  if v_rf_meta <> '{}'::jsonb then
    v_delta := v_delta || jsonb_build_object('rubberflow', jsonb_build_object('opened', v_rf_opened, 'skipped', v_rf_skipped, 'cancelled', v_rf_cancelled));
  end if;
  return v_delta;
end;
$$;

revoke all on function public.app_bom_save_master(jsonb, bigint, text, jsonb, text) from public, anon;
grant execute on function public.app_bom_save_master(jsonb, bigint, text, jsonb, text) to authenticated;
