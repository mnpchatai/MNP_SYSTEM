-- Additive migration. Existing loss amounts remain intact and require explicit review.
-- Deploy database before the matching Pilot assets. No production data is deleted.
alter table public.ncr_losses
  add column cost_status text not null default 'legacy' check (cost_status in ('legacy', 'estimated', 'confirmed')),
  add column entry_kind text not null default 'loss' check (entry_kind in ('loss', 'recovery')),
  add column component text not null default 'quantity' check (component in ('quantity', 'labor', 'material', 'external', 'amount')),
  add column incurred_on date,
  add column evidence_ref text check (evidence_ref is null or char_length(evidence_ref) between 1 and 200),
  add column verified_by uuid references public.employees(id),
  add column verified_at timestamptz;
update public.ncr_losses set incurred_on = (recorded_at at time zone 'Asia/Bangkok')::date;
alter table public.ncr_losses alter column incurred_on set not null;
alter table public.ncr_losses alter column incurred_on set default private.bangkok_today();
alter table public.ncr_losses alter column cost_status set default 'estimated';
alter table public.ncr_losses add constraint ncr_loss_confirmation_check check (
  (cost_status = 'confirmed' and evidence_ref is not null and verified_by is not null and verified_at is not null)
  or (cost_status <> 'confirmed' and verified_by is null and verified_at is null)
);
create index ncr_losses_period_idx on public.ncr_losses(incurred_on, ncr_id) where voided_at is null;

-- One current final-outcome snapshot per NCR (the report already represents one product/lot).
-- qty_sorted is an activity and is never added to final outcomes.
create table public.ncr_outcomes (
  ncr_id uuid primary key references public.ncr_reports(id) on delete cascade,
  result_date date not null,
  result_status text not null check (result_status in ('draft', 'confirmed')),
  qty_sorted numeric(14,3) not null default 0 check (qty_sorted >= 0),
  qty_repaired numeric(14,3) not null default 0 check (qty_repaired >= 0),
  qty_scrapped numeric(14,3) not null default 0 check (qty_scrapped >= 0),
  qty_returned numeric(14,3) not null default 0 check (qty_returned >= 0),
  qty_accepted numeric(14,3) not null default 0 check (qty_accepted >= 0),
  downtime_hours numeric(14,3) not null default 0 check (downtime_hours >= 0),
  cost_reviewed boolean not null default false,
  evidence_ref text check (evidence_ref is null or char_length(evidence_ref) between 1 and 200),
  note text check (note is null or char_length(note) <= 1000),
  updated_by uuid not null references public.employees(id),
  updated_at timestamptz not null default now(),
  verified_by uuid references public.employees(id),
  verified_at timestamptz,
  check ((result_status = 'confirmed' and evidence_ref is not null and verified_by is not null and verified_at is not null)
    or (result_status = 'draft' and verified_by is null and verified_at is null)),
  check (not cost_reviewed or result_status = 'confirmed')
);
alter table public.ncr_outcomes enable row level security;
revoke all on table public.ncr_outcomes from anon, authenticated;
grant select on table public.ncr_outcomes to authenticated;
create policy ncr_outcomes_read on public.ncr_outcomes for select to authenticated using (private.can_access_ncr(ncr_id));
create trigger ncr_outcomes_audit after insert or update or delete on public.ncr_outcomes for each row execute function private.audit_row_change();
create trigger ncr_outcomes_sandbox_scope before insert or update or delete on public.ncr_outcomes for each row execute function private.ncr_child_sandbox_scope();
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes']
$$;

-- Editing/voiding through either the new API or the existing batch API invalidates the review.
create or replace function private.ncr_invalidate_cost_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.ncr_outcomes set cost_reviewed = false
  where ncr_id = case when tg_op = 'DELETE' then old.ncr_id else new.ncr_id end;
  return coalesce(new,old);
end;
$$;
revoke all on function private.ncr_invalidate_cost_review() from public,anon,authenticated;
create trigger ncr_losses_invalidate_review after insert or update or delete on public.ncr_losses
for each row execute function private.ncr_invalidate_cost_review();

create or replace function public.app_ncr_record_loss(p_ncr_id uuid, p_entry jsonb, p_loss_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_loss public.ncr_losses%rowtype;
  v_id uuid;
  v_type text := p_entry->>'loss_type';
  v_kind text := p_entry->>'entry_kind';
  v_status text := p_entry->>'cost_status';
  v_component text := p_entry->>'component';
  v_qty numeric := round((p_entry->>'quantity')::numeric, 3);
  v_rate numeric := round((p_entry->>'unit_cost')::numeric, 2);
  v_unit text := trim(coalesce(p_entry->>'unit', ''));
  v_ref text := nullif(trim(coalesce(p_entry->>'evidence_ref', '')), '');
  v_date date := (p_entry->>'incurred_on')::date;
  v_note text := nullif(trim(coalesce(p_entry->>'note', '')), '');
begin
  v_employee := private.ncr_current_employee();
  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then raise exception 'NCR_NOT_FOUND'; end if;
  if not v_employee.is_test or not v_ncr.is_test then raise exception 'SANDBOX_ONLY'; end if;
  if not private.can_edit_ncr_losses(v_ncr.id, v_employee) then raise exception 'NOT_AUTHORIZED'; end if;
  if v_ncr.status in ('closed', 'cancelled') then raise exception 'NCR_LOCKED'; end if;
  if v_type is null or v_type not in ('scrap','material','rework','sort','reproduce','logistics','claim','downtime','other')
    or v_kind is null or v_kind not in ('loss','recovery') then raise exception 'INVALID_LOSS_TYPE'; end if;
  if v_status is null or v_status not in ('estimated','confirmed') then raise exception 'INVALID_LOSS_STATUS'; end if;
  if v_component is null or not (
    (v_kind = 'recovery' and v_component = 'amount') or
    (v_kind = 'loss' and (
      (v_type = 'rework' and v_component in ('labor','material','external')) or
      (v_type = 'sort' and v_component in ('labor','external')) or
      (v_type in ('scrap','material','downtime') and v_component = 'quantity') or
      (v_type in ('reproduce','logistics','claim','other') and v_component = 'amount')
    ))) then raise exception 'INVALID_LOSS_COMPONENT'; end if;
  if v_qty is null or v_qty::text in ('NaN','Infinity','-Infinity') or v_qty <= 0 or v_qty > 1e9
    or v_rate is null or v_rate::text in ('NaN','Infinity','-Infinity') or v_rate < 0 or v_rate > 1e9
    or v_qty * v_rate >= 1e14 or char_length(v_unit) not between 1 and 20
    or char_length(coalesce(v_note,'')) > 500 or char_length(coalesce(v_ref,'')) > 200
    or (v_component in ('amount','external') and v_qty <> 1)
    then raise exception 'INVALID_LOSS'; end if;
  if v_date is null or not isfinite(v_date) or (v_status = 'confirmed' and v_date > private.bangkok_today()) then raise exception 'INVALID_LOSS_DATE'; end if;
  if v_status = 'confirmed' and v_ref is null then raise exception 'LOSS_EVIDENCE_REQUIRED'; end if;
  if v_type = 'other' and v_kind = 'loss' and char_length(coalesce(v_note,'')) < 5 then raise exception 'INVALID_LOSS_NOTE'; end if;
  if p_loss_id is not null then
    select * into v_loss from public.ncr_losses where id = p_loss_id and ncr_id = v_ncr.id for update;
    if v_loss.id is null then raise exception 'LOSS_NOT_FOUND'; end if;
    if v_loss.voided_at is not null then raise exception 'LOSS_ALREADY_VOIDED'; end if;
    -- Revising an existing estimate/legacy row replaces its amount, never creates a duplicate actual.
    update public.ncr_losses set loss_type = v_type, entry_kind = v_kind, cost_status = v_status,
      component = v_component, quantity = v_qty, unit = v_unit, unit_cost = v_rate,
      incurred_on = v_date, evidence_ref = v_ref, note = v_note,
      verified_by = case when v_status = 'confirmed' then v_employee.id end,
      verified_at = case when v_status = 'confirmed' then now() end
    where id = v_loss.id returning id into v_id;
  else
    insert into public.ncr_losses (ncr_id,loss_type,entry_kind,cost_status,component,quantity,unit,unit_cost,incurred_on,evidence_ref,note,recorded_by,verified_by,verified_at)
    values (v_ncr.id,v_type,v_kind,v_status,v_component,v_qty,v_unit,v_rate,v_date,v_ref,v_note,v_employee.id,
      case when v_status = 'confirmed' then v_employee.id end, case when v_status = 'confirmed' then now() end)
    returning id into v_id;
  end if;
  update public.ncr_outcomes set cost_reviewed = false where ncr_id = v_ncr.id;
  perform private.ncr_log(v_ncr.id,v_ncr.status,v_ncr.status,'loss_record',v_id::text || ' · ' || v_kind || ' · ' || v_status || ' · ' || round(v_qty*v_rate,2)::text,v_employee.id);
  return v_id;
end;
$$;

create or replace function public.app_ncr_save_outcome(p_ncr_id uuid, p_result jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_status text := p_result->>'result_status';
  v_date date := (p_result->>'result_date')::date;
  v_ref text := nullif(trim(coalesce(p_result->>'evidence_ref','')), '');
  v_note text := nullif(trim(coalesce(p_result->>'note','')), '');
  v_sorted numeric := round((p_result->>'qty_sorted')::numeric,3);
  v_repaired numeric := round((p_result->>'qty_repaired')::numeric,3);
  v_scrapped numeric := round((p_result->>'qty_scrapped')::numeric,3);
  v_returned numeric := round((p_result->>'qty_returned')::numeric,3);
  v_accepted numeric := round((p_result->>'qty_accepted')::numeric,3);
  v_hours numeric := round((p_result->>'downtime_hours')::numeric,3);
  v_reviewed boolean := coalesce((p_result->>'cost_reviewed')::boolean,false);
  v_value numeric;
begin
  v_employee := private.ncr_current_employee();
  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then raise exception 'NCR_NOT_FOUND'; end if;
  if not v_employee.is_test or not v_ncr.is_test then raise exception 'SANDBOX_ONLY'; end if;
  if not private.can_edit_ncr_losses(v_ncr.id,v_employee) then raise exception 'NOT_AUTHORIZED'; end if;
  if v_ncr.status in ('closed','cancelled') then raise exception 'NCR_LOCKED'; end if;
  if v_status is null or v_status not in ('draft','confirmed') then raise exception 'INVALID_OUTCOME'; end if;
  foreach v_value in array array[v_sorted,v_repaired,v_scrapped,v_returned,v_accepted,v_hours] loop
    if v_value is null or v_value::text in ('NaN','Infinity','-Infinity') or v_value < 0 or v_value > 1e9 then raise exception 'INVALID_OUTCOME'; end if;
  end loop;
  if v_sorted > v_ncr.qty_total or v_repaired + v_scrapped + v_returned + v_accepted > v_ncr.qty_total then raise exception 'OUTCOME_EXCEEDS_LOT'; end if;
  if v_date is null or not isfinite(v_date) or v_date > private.bangkok_today()
    or char_length(coalesce(v_ref,'')) > 200 or char_length(coalesce(v_note,'')) > 1000 then raise exception 'INVALID_OUTCOME'; end if;
  if v_status = 'confirmed' and v_ref is null then raise exception 'LOSS_EVIDENCE_REQUIRED'; end if;
  if v_reviewed and (v_status <> 'confirmed' or exists(select 1 from public.ncr_losses where ncr_id = v_ncr.id and voided_at is null and cost_status <> 'confirmed')) then raise exception 'COST_REVIEW_PENDING'; end if;
  if v_reviewed and not exists(select 1 from public.ncr_losses where ncr_id = v_ncr.id and voided_at is null) and v_note is null then raise exception 'ZERO_COST_REASON_REQUIRED'; end if;
  insert into public.ncr_outcomes (ncr_id,result_date,result_status,qty_sorted,qty_repaired,qty_scrapped,qty_returned,qty_accepted,downtime_hours,cost_reviewed,evidence_ref,note,updated_by,verified_by,verified_at)
  values(v_ncr.id,v_date,v_status,v_sorted,v_repaired,v_scrapped,v_returned,v_accepted,v_hours,v_reviewed,v_ref,v_note,v_employee.id,
    case when v_status = 'confirmed' then v_employee.id end,case when v_status = 'confirmed' then now() end)
  on conflict (ncr_id) do update set result_date=excluded.result_date,result_status=excluded.result_status,
    qty_sorted=excluded.qty_sorted,qty_repaired=excluded.qty_repaired,qty_scrapped=excluded.qty_scrapped,
    qty_returned=excluded.qty_returned,qty_accepted=excluded.qty_accepted,downtime_hours=excluded.downtime_hours,
    cost_reviewed=excluded.cost_reviewed,evidence_ref=excluded.evidence_ref,note=excluded.note,
    updated_by=excluded.updated_by,updated_at=now(),verified_by=excluded.verified_by,verified_at=excluded.verified_at;
  perform private.ncr_log(v_ncr.id,v_ncr.status,v_ncr.status,'outcome_record',v_status || ' · ' || coalesce(v_note,''),v_employee.id);
  return v_ncr.id;
end;
$$;

revoke all on function public.app_ncr_record_loss(uuid,jsonb,uuid) from public,anon;
revoke all on function public.app_ncr_save_outcome(uuid,jsonb) from public,anon;
grant execute on function public.app_ncr_record_loss(uuid,jsonb,uuid) to authenticated;
grant execute on function public.app_ncr_save_outcome(uuid,jsonb) to authenticated;
