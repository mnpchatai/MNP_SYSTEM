import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const model = createRequire(import.meta.url)("../../modules/factory-lot-model.js");

const lot = (lotNumber, extra = {}) => ({ id: `id-${lotNumber}`, version: 1, lot_number: lotNumber, item_id: "i1", item_code: "RM-NR", item_name: "ยางธรรมชาติ",
  unit_code: "KG", received_date: "2026-10-01", expiry_date: null, on_hold: false, hold_reason: "", status: "available", balance: 10, ...extra });
const DATA = {
  today: "2026-10-28",
  can_set_expiry: true,
  can_hold: false,
  lots: [
    lot("A", { expiry_date: "2026-11-10" }),
    lot("B", { expiry_date: "2027-03-01" }),
    lot("H", { on_hold: true, hold_reason: "MDR ไม่ผ่าน", status: "hold" }),
    lot("X", { expiry_date: "2026-10-27", status: "expired" }),
    lot("E", { balance: 0 }),
    lot("Z", { item_code: "RM-CB", item_name: "คาร์บอนแบล็ก" }),
  ],
};

test("lots expiring within 30 days read as near expiry, others keep the database status", () => {
  assert.equal(model.displayStatus(DATA.lots[0], DATA.today), "near");
  assert.equal(model.displayStatus(lot("edge", { expiry_date: "2026-11-27" }), DATA.today), "near");
  assert.equal(model.displayStatus(lot("far", { expiry_date: "2026-11-28" }), DATA.today), "available");
  assert.equal(model.displayStatus(DATA.lots[2], DATA.today), "hold");
  assert.equal(model.displayStatus(DATA.lots[3], DATA.today), "expired");
  assert.equal(model.displayStatus(DATA.lots[5], DATA.today), "available");
});

test("rows keep the FEFO order of the RPC, hide empty lots and filter by status and text", () => {
  assert.deepEqual(model.rows(DATA).map((row) => row.lot_number), ["A", "B", "H", "X", "Z"]);
  assert.deepEqual(model.rows(DATA, { status: "available" }).map((row) => row.lot_number), ["A", "B", "Z"]);
  assert.deepEqual(model.rows(DATA, { status: "near" }).map((row) => row.lot_number), ["A"]);
  assert.deepEqual(model.rows(DATA, { status: "hold" }).map((row) => row.lot_number), ["H"]);
  assert.deepEqual(model.rows(DATA, { status: "expired" }).map((row) => row.lot_number), ["X"]);
  assert.deepEqual(model.rows(DATA, { q: "คาร์บอน" }).map((row) => row.lot_number), ["Z"]);
  assert.deepEqual(model.rows(DATA, { q: "rm-cb" }).map((row) => row.lot_number), ["Z"]);
  assert.deepEqual(model.rows({ today: DATA.today }), []);
});

test("unknown status filters fall back to all", () => {
  assert.equal(model.filterOf("hold"), "hold");
  assert.equal(model.filterOf("<script>"), "all");
  assert.equal(model.filterOf(null), "all");
});

test("the actions follow the persona flags from the RPC", () => {
  assert.deepEqual(model.actionsFor(DATA.lots[0], DATA), { expiry: true, hold: false, release: false });
  const qa = { ...DATA, can_hold: true };
  assert.deepEqual(model.actionsFor(DATA.lots[0], qa), { expiry: true, hold: true, release: false });
  assert.deepEqual(model.actionsFor(DATA.lots[2], qa), { expiry: true, hold: false, release: true });
  assert.deepEqual(model.actionsFor(DATA.lots[0], {}), { expiry: false, hold: false, release: false });
});

test("the expiry form checks the date before sending and an empty value clears it", () => {
  const a = DATA.lots[0];
  assert.deepEqual(model.expiryPayload(a, "2026-12-31"), { args: { p_id: "id-A", p_version: 1, p_expiry_date: "2026-12-31" } });
  assert.deepEqual(model.expiryPayload(a, ""), { args: { p_id: "id-A", p_version: 1, p_expiry_date: null } });
  assert.equal(model.expiryPayload(a, "2026-11-10").error, "วันหมดอายุเหมือนเดิม");
  assert.equal(model.expiryPayload(lot("none"), "").error, "วันหมดอายุเหมือนเดิม");
  assert.equal(model.expiryPayload(a, "2026-09-30").error, "วันหมดอายุต้องไม่ก่อนวันที่รับของ");
  assert.equal(model.expiryPayload(a, "2026-02-30").error, "วันหมดอายุไม่ถูกต้อง");
  assert.equal(model.expiryPayload(a, "2101-01-01").error, "วันหมดอายุไม่ถูกต้อง");
  assert.equal(model.expiryPayload(a, "31/12/2026").error, "วันหมดอายุไม่ถูกต้อง");
});

test("the hold form needs a reason of 10 to 1,000 characters", () => {
  const a = DATA.lots[0];
  assert.deepEqual(model.holdPayload(a, true, "  ผล MDR ไม่ผ่าน  "), { args: { p_id: "id-A", p_version: 1, p_hold: true, p_note: "ผล MDR ไม่ผ่าน" } });
  assert.equal(model.holdPayload(a, false, "ตรวจซ้ำผ่านแล้ว").args.p_hold, false);
  assert.match(model.holdPayload(a, true, "สั้น").error, /10–1,000/);
  assert.match(model.holdPayload(a, true, "ก".repeat(1001)).error, /10–1,000/);
  assert.match(model.holdPayload(a, true, null).error, /10–1,000/);
});
