-- MNP LAB: กราฟแรงบิด MDR หลายวัน (แถบช่วงวันของกราฟแรงบิด F1 ที่ #/lab?module=mdr&part=F1)
--
-- app_lab_mdr_feed (20261215010000) ส่งกราฟของวันเดียว แถบช่วงวันของกราฟแรงบิดเลือกได้หลายวันจนถึง "ทั้งหมด"
-- ฟังก์ชันอ่านอย่างเดียวนี้ส่งกราฟของทุกวันในช่วง p_from ถึง p_to ของสูตรเดียว:
--   วันเดียว (p_from = p_to) = ทุก 1 วินาที เหมือน feed · หลายวัน = ทุก 5 วินาที (กราฟ 30 นาที 1801 → 361 จุด)
--   ไม่เกิน 1,000 กราฟต่อครั้ง: นับวันจากวันล่าสุดในช่วงย้อนไป รวมทั้งวันจนกว่าวันถัดไปจะทำให้เกิน
--   (truncated = true และ from = วันแรกที่ส่งจริง หน้าเว็บบอกผู้ใช้ว่าแสดงเฉพาะวันใด)
--
-- สิทธิ์เหมือน feed: ตรวจ auth.uid() และ private.can_access_lab() ทุกครั้ง อ่านตารางผ่าน security definer เท่านั้น
-- (ตาราง lab_mdr_tests ไม่ grant ให้ anon/authenticated) ไม่เขียนอะไร
--
-- Rollback: drop function public.app_lab_mdr_curves(text, text, date, date);
-- (หน้าเว็บที่ไม่มีฟังก์ชันนี้ยังแสดงกราฟวันเดียวของ feed ได้ ส่วนช่วงหลายวันจะแจ้งว่าอ่านกราฟไม่สำเร็จ)

create function public.app_lab_mdr_curves(p_part text, p_formula text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_formula text := nullif(btrim(p_formula), '');
  v_step integer;
  v_max_curves constant integer := 1000;
  v_days integer;
  v_kept date[];
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.can_access_lab() then raise exception 'NOT_AUTHORIZED'; end if;
  if p_part is null or p_part not in ('F1', 'F2') then raise exception 'LAB_MDR_INVALID_PART'; end if;
  if v_formula is null or char_length(v_formula) > 40 then raise exception 'LAB_MDR_INVALID_FORMULA'; end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3660 then raise exception 'LAB_MDR_INVALID_RANGE'; end if;
  v_step := case when p_from = p_to then 1 else 5 end;

  -- วันที่มีกราฟในช่วง นับจากวันล่าสุดย้อนไป เก็บทั้งวันตราบที่ยอดรวมไม่เกิน v_max_curves
  -- (วันเดียวที่มีเกินเอง — ไม่เกิดกับข้อมูลจริงราว 15 ครั้งต่อวัน — ยังได้วันล่าสุดวันนั้น ตัดที่ v_max_curves ด้านล่าง)
  with days as (
    select t.test_date, count(*) as n
    from public.lab_mdr_tests t
    where t.part = p_part and t.formula = v_formula and t.test_date between p_from and p_to and t.curve is not null
    group by t.test_date
  ), running as (
    select d.test_date, sum(d.n) over (order by d.test_date desc) as total, row_number() over (order by d.test_date desc) as rank
    from days d
  )
  select (select count(*) from days)::integer,
         coalesce(array_agg(r.test_date order by r.test_date) filter (where r.total <= v_max_curves or r.rank = 1), '{}'::date[])
  into v_days, v_kept
  from running r;

  return jsonb_build_object(
    'step', v_step,
    'from', v_kept[1],
    'to', v_kept[cardinality(v_kept)],
    'truncated', cardinality(v_kept) < v_days,
    'curves', coalesce((
      select jsonb_agg(c.item order by c.test_date, c.test_time, c.machine_id)
      from (
        select t.test_date, t.test_time, t.machine_id,
               jsonb_build_object(
                 'id', t.id, 'test_date', t.test_date,
                 'curve', case when v_step = 1 then to_jsonb(t.curve)
                   else to_jsonb(array(select t.curve[i] from generate_series(1, cardinality(t.curve), v_step) as i order by i)) end
               ) as item
        from public.lab_mdr_tests t
        where t.part = p_part and t.formula = v_formula and t.test_date = any (v_kept) and t.curve is not null
        order by t.test_date desc, t.test_time, t.machine_id
        limit v_max_curves
      ) c
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.app_lab_mdr_curves(text, text, date, date) from public, anon;
grant execute on function public.app_lab_mdr_curves(text, text, date, date) to authenticated;
