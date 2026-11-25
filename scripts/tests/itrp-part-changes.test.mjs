import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// ส่วน "เปลี่ยน / ย้ายชิ้นส่วน" ของใบแจ้งซ่อม: กติกาฝั่งหน้าเว็บ (modules/itrp-model.js) และ HTML (modules/itrp-pages.js)
// การเรียก RPC และการผูกปุ่ม ทดสอบที่ scripts/tests/itrp-module.test.mjs · กติกาฝั่งฐานข้อมูลทดสอบที่ supabase/tests/database/itrp_itas_part_changes.test.sql
const require = createRequire(import.meta.url);
globalThis.MNP_UI_ICONS = require("../../modules/ui-icons.js");
globalThis.MNP_ITRP_MODEL = require("../../modules/itrp-model.js");
const model = globalThis.MNP_ITRP_MODEL;
const pages = require("../../modules/itrp-pages.js");

const XSS = '<img src=x onerror="alert(1)">';
const part = (id, type, regNo, extra = {}) => ({ id, type_code: type, type_name: type, reg_no: regNo, device_code: null, name: `${type} ${regNo}`, model: null, serial: null, status: "in_use", host_code: "COM01", slot: null, place: null, ...extra });

// คำตอบของ app_itrp_part_changes_context (รูปตามสัญญา docs/itrp-contract.md)
const CONTEXT = (overrides = {}) => ({
  request: { id: "r1", doc_no: "IT01-26/050", status: "in_progress", is_test: false, asset_code: "COM01", device_name: "Dell" },
  can_apply: true, blocked_reason: null, max_changes: 20, result_statuses: ["broken", "spare", "retired"],
  hosts: [
    { host_code: "COM01", source: "request", device: part("d1", "COMPUTER", "REG-D1", { device_code: "COM01", name: "Dell OptiPlex", host_code: null }),
      parts: [part("p1", "RAM", "RAM-001", { slot: "DIMM1", serial: "SN1" }), part("p2", "SSD", "SSD-001", { status: "broken" }), part("p3", "HDD", "HDD-001", { status: "spare" })] },
    { host_code: "COM09", source: "report", device: null, parts: [] },
  ],
  spares: [
    { type_code: "RAM", type_name: "RAM", items: [part("s1", "RAM", "RAM-009", { status: "spare", host_code: null, place: "ตู้ A" }), part("s2", "RAM", "RAM-010", { status: "spare", host_code: null })] },
    { type_code: "SSD", type_name: "SSD", items: [part("s3", "SSD", "SSD-009", { status: "spare", host_code: null })] },
  ],
  move_targets: [{ device_code: "COM01", name: "Dell", type_code: "COMPUTER" }, { device_code: "COM02", name: "HP", type_code: "COMPUTER" }],
  ...overrides,
});
const ctx = (overrides) => model.normalizePartContext(CONTEXT(overrides));

/* ---------- context ---------- */
test("the context is normalised, and anything that is not an object is rejected so the section stays hidden", () => {
  assert.equal(model.normalizePartContext(null), null);
  assert.equal(model.normalizePartContext("x"), null);
  assert.equal(model.normalizePartContext([]), null);
  const value = ctx();
  assert.equal(value.canApply, true);
  assert.equal(value.max, 20);
  assert.deepEqual(value.hosts.map((host) => host.code), ["COM01", "COM09"]);
  assert.deepEqual(value.spares.map((group) => group.typeCode), ["RAM", "SSD"]);
  assert.deepEqual(value.moveTargets.map((target) => target.code), ["COM01", "COM02"]);
  const blocked = ctx({ can_apply: false, blocked_reason: "ใบนี้ยังไม่มีรหัสเครื่อง", hosts: [] });
  assert.equal(blocked.canApply, false);
  assert.equal(blocked.blockedReason, "ใบนี้ยังไม่มีรหัสเครื่อง");
  assert.equal(model.normalizePartContext({ can_apply: true, hosts: "bad", spares: 3 }).hosts.length, 0, "malformed lists become empty lists");
});

test("parts are grouped by type and only in-use or broken parts can be changed", () => {
  const groups = model.partGroups(ctx().hosts[0].parts);
  assert.deepEqual(groups.map((group) => [group.typeCode, group.items.length]), [["RAM", 1], ["SSD", 1], ["HDD", 1]]);
  assert.equal(model.canChangePart({ status: "in_use" }), true);
  assert.equal(model.canChangePart({ status: "broken" }), true);
  assert.equal(model.canChangePart({ status: "spare" }), false);
  assert.equal(model.canChangePart({ status: "retired" }), false);
  assert.equal(model.partAssetLabel({ reg_no: "RAM-001", name: "Kingston 8GB" }), "RAM-001 · Kingston 8GB");
  assert.equal(model.partAssetLabel({ device_code: "COM01", name: "COM01" }), "COM01", "the same text is not repeated");
  assert.equal(model.partAssetLabel({}), "ชิ้นส่วนไม่มีชื่อ");
});

test("spares exclude the ones already chosen, can be limited to a type, and can be searched", () => {
  const value = ctx();
  assert.deepEqual(model.availableSpares(value, [], { typeCode: "RAM" }).flatMap((group) => group.items.map((item) => item.id)), ["s1", "s2"]);
  assert.deepEqual(model.availableSpares(value, [{ asset_id: "p1", new_asset_id: "s1" }], { typeCode: "RAM" }).flatMap((group) => group.items.map((item) => item.id)), ["s2"]);
  assert.deepEqual(model.availableSpares(value, [], { query: "ตู้ a" }).flatMap((group) => group.items.map((item) => item.id)), ["s1"], "searches the place, case-insensitive");
  assert.deepEqual(model.availableSpares(value, [], { query: "ssd-009" }).map((group) => group.typeCode), ["SSD"]);
  assert.deepEqual(model.availableMoveTargets(value, "COM01").map((target) => target.code), ["COM02"], "the source machine is not offered");
});

/* ---------- เพิ่มรายการ ---------- */
const REPLACE = { action: "replace", host_code: "COM01", asset_id: "p1", new_asset_id: "s1", result_status: "broken", slot: "", note: "" };

test("a valid replace is added with only the fields its action accepts", () => {
  const result = model.addPartChange([], { ...REPLACE, to_host_code: "COM02", slot: " DIMM2 ", note: "เสียบไม่แน่น" }, ctx());
  assert.equal(result.error, undefined);
  assert.deepEqual(result.rows, [{ action: "replace", host_code: "COM01", asset_id: "p1", new_asset_id: "s1", result_status: "broken", slot: "DIMM2", note: "เสียบไม่แน่น" }]);
  assert.deepEqual(model.partChangePayload([{ ...REPLACE }]), [{ action: "replace", host_code: "COM01", asset_id: "p1", new_asset_id: "s1", result_status: "broken" }], "empty slot and note are not sent");
});

test("each action sends exactly its own fields (the database rejects fields that do not belong)", () => {
  const value = ctx();
  const remove = model.addPartChange([], { action: "remove", host_code: "COM01", asset_id: "p2", result_status: "retired", new_asset_id: "s3", to_host_code: "COM02", slot: "x", note: "n" }, value).rows[0];
  assert.deepEqual(remove, { action: "remove", host_code: "COM01", asset_id: "p2", result_status: "retired", note: "n" });
  const move = model.addPartChange([], { action: "move", host_code: "COM01", asset_id: "p1", to_host_code: "COM02", result_status: "broken", new_asset_id: "s1", slot: "DIMM1" }, value).rows[0];
  assert.deepEqual(move, { action: "move", host_code: "COM01", asset_id: "p1", to_host_code: "COM02", slot: "DIMM1" });
  const install = model.addPartChange([], { action: "install", host_code: "COM09", asset_id: "s3", result_status: "broken", to_host_code: "COM02", slot: "M.2" }, value).rows[0];
  assert.deepEqual(install, { action: "install", host_code: "COM09", asset_id: "s3", slot: "M.2" });
});

test("a replace must use a spare of the same type, and a spare cannot be used twice", () => {
  const value = ctx();
  assert.match(model.addPartChange([], { ...REPLACE, new_asset_id: "s3" }, value).error, /ชนิดไม่ตรงกัน/);
  const first = model.addPartChange([], REPLACE, value).rows;
  assert.match(model.addPartChange(first, { ...REPLACE, asset_id: "p2", new_asset_id: "s1" }, value).error, /อยู่ในรายการที่เลือกไว้แล้ว/);
  assert.match(model.addPartChange(first, { action: "remove", host_code: "COM01", asset_id: "p1", result_status: "broken" }, value).error, /อยู่ในรายการที่เลือกไว้แล้ว/, "the replaced part cannot also be removed");
  assert.match(model.addPartChange(first, { action: "install", host_code: "COM01", asset_id: "s1" }, value).error, /อยู่ในรายการที่เลือกไว้แล้ว/, "the new part cannot also be installed");
  assert.equal(model.addPartChange(first, { ...REPLACE, asset_id: "p2", new_asset_id: "s3", result_status: "spare" }, value).error, undefined);
});

test("missing choices and unusable parts are explained in Thai", () => {
  const value = ctx();
  assert.match(model.addPartChange([], { ...REPLACE, new_asset_id: "" }, value).error, /กรุณาเลือกชิ้นสำรองที่จะใส่แทน/);
  assert.match(model.addPartChange([], { ...REPLACE, result_status: "" }, value).error, /กรุณาเลือกสถานะของชิ้นเดิม/);
  assert.match(model.addPartChange([], { ...REPLACE, result_status: "in_use" }, value).error, /กรุณาเลือกสถานะของชิ้นเดิม/);
  assert.match(model.addPartChange([], { ...REPLACE, asset_id: "p3", new_asset_id: "s1" }, value).error, /มีสถานะ "สำรอง"/, "a spare part is not installed so it cannot be replaced");
  assert.match(model.addPartChange([], { ...REPLACE, asset_id: "nope" }, value).error, /ไม่พบชิ้นส่วนนี้ในเครื่อง/);
  assert.match(model.addPartChange([], { ...REPLACE, host_code: "COM99" }, value).error, /กรุณาเลือกเครื่อง/);
  assert.match(model.addPartChange([], { ...REPLACE, new_asset_id: "p2" }, value).error, /ไม่พบชิ้นสำรองนี้/, "a part that is installed is not a spare");
  assert.match(model.addPartChange([], { action: "install", host_code: "COM01", asset_id: "" }, value).error, /กรุณาเลือกชิ้นสำรองที่จะติดตั้ง/);
  assert.match(model.addPartChange([], { action: "install", host_code: "COM01", asset_id: "p1" }, value).error, /ไม่พบชิ้นสำรองนี้/);
  assert.match(model.addPartChange([], { action: "fly", host_code: "COM01", asset_id: "p1" }, value).error, /กรุณาเลือกประเภทรายการ/);
  assert.match(model.addPartChange([], { ...REPLACE, slot: "x".repeat(51) }, value).error, /ช่อง\/Slot ต้องไม่เกิน 50/);
  assert.match(model.addPartChange([], { ...REPLACE, note: "x".repeat(201) }, value).error, /หมายเหตุต้องไม่เกิน 200/);
});

test("a move needs another machine that exists in the register", () => {
  const value = ctx();
  const move = (target) => model.addPartChange([], { action: "move", host_code: "COM01", asset_id: "p1", to_host_code: target }, value);
  assert.match(move("").error, /กรุณาเลือกเครื่องปลายทาง/);
  assert.match(move("COM01").error, /คนละเครื่อง/);
  assert.match(move("COM77").error, /ไม่พบเครื่องปลายทาง/);
  assert.equal(move("COM02").error, undefined);
});

test("no more than 20 changes can be chosen at once", () => {
  const spares = Array.from({ length: 21 }, (_, index) => part(`n${index}`, "RAM", `N-${index}`, { status: "spare", host_code: null }));
  const value = ctx({ spares: [{ type_code: "RAM", type_name: "RAM", items: spares }] });
  let rows = [];
  for (let index = 0; index < 20; index += 1) {
    const result = model.addPartChange(rows, { action: "install", host_code: "COM01", asset_id: `n${index}` }, value);
    assert.equal(result.error, undefined);
    rows = result.rows;
  }
  assert.match(model.addPartChange(rows, { action: "install", host_code: "COM01", asset_id: "n20" }, value).error, /ไม่เกิน 20 รายการ/);
});

test("the summary names the machine, the parts and the result in Thai", () => {
  const value = ctx();
  assert.equal(model.partChangeSummary({ ...REPLACE, slot: "DIMM2" }, value), "เครื่อง COM01: เปลี่ยน RAM-001 · RAM RAM-001 เป็น RAM-009 · RAM RAM-009 · ชิ้นเดิมเป็นชำรุด · ช่อง DIMM2");
  assert.match(model.partChangeSummary({ action: "remove", host_code: "COM01", asset_id: "p2", result_status: "retired", note: "เก่า" }, value), /ถอด SSD-001 · SSD SSD-001 ออก · ชิ้นเดิมเป็นยกเลิกใช้งาน · หมายเหตุ: เก่า/);
  assert.match(model.partChangeSummary({ action: "move", host_code: "COM01", asset_id: "p1", to_host_code: "COM02" }, value), /ย้าย .* ไปเครื่อง COM02/);
  assert.match(model.partChangeSummary({ action: "install", host_code: "COM09", asset_id: "s3" }, value), /เครื่อง COM09: ติดตั้ง SSD-009/);
});

/* ---------- ข้อมูลเก่าหลังทะเบียนเปลี่ยน ---------- */
test("after the register changed, rows that no longer fit are dropped and the rest are kept in order", () => {
  const value = ctx();
  const rows = [REPLACE, { action: "remove", host_code: "COM01", asset_id: "p2", result_status: "broken" }, { action: "install", host_code: "COM09", asset_id: "s3" }].map((row) => model.cleanPartChange(row));
  const fresh = ctx({ hosts: [{ host_code: "COM01", source: "request", device: null, parts: [part("p2", "SSD", "SSD-001", { status: "broken" })] }, { host_code: "COM09", source: "report", device: null, parts: [] }] });
  const pruned = model.pruneStalePartChanges(rows, fresh);
  assert.equal(pruned.dropped, 1, "p1 was already replaced by someone else");
  assert.deepEqual(pruned.rows.map((row) => row.asset_id), ["p2", "s3"]);
  assert.deepEqual(model.pruneStalePartChanges(rows, value), { rows, dropped: 0 });
});

test("the row number in a database error is read so the right row can be highlighted", () => {
  assert.equal(model.partChangeErrorRow("แถวที่ 3: ชนิดไม่ตรงกัน"), 3);
  assert.equal(model.partChangeErrorRow("  แถวที่ 12: x"), 12);
  assert.equal(model.partChangeErrorRow("ใช้ชิ้นส่วนเดียวกันซ้ำ"), null);
  assert.equal(model.partChangeErrorRow(undefined), null);
  // ข้อความ error 23514 ภาษาไทยของฐานข้อมูลส่งต่อถึงผู้ใช้ตรง ๆ
  assert.deepEqual(model.describeError({ code: "23514", message: "แถวที่ 2: ชนิดไม่ตรงกัน" }, { write: true }), { kind: "rejected", message: "แถวที่ 2: ชนิดไม่ตรงกัน", forwarded: true });
});

/* ---------- ประวัติ ---------- */
const ITEM = (overrides) => ({ id: 1, line_no: 1, action: "replace", host_code: "COM01", to_host_code: null, asset: { type_code: "RAM", type_name: "RAM", reg_no: "RAM-001", device_code: null, name: "Kingston 8GB" }, new_asset: { type_code: "RAM", type_name: "RAM", reg_no: "RAM-009", device_code: null, name: "Kingston 8GB" }, result_status: "broken", slot: "DIMM1", note: null, actor_employee_no: "IT3462", actor_full_name: "สุริยา", created_at: "2026-11-25T03:00:00Z", ...overrides });

test("the saved history is shown as plain Thai sentences in the order the database returned", () => {
  const items = model.partChangeItems({ items: [
    ITEM(),
    ITEM({ id: 2, action: "remove", new_asset: null, result_status: "retired", slot: null }),
    ITEM({ id: 3, action: "move", to_host_code: "COM02", new_asset: null, result_status: null }),
    ITEM({ id: 4, action: "install", new_asset: null, result_status: null, actor_full_name: null }),
    ITEM({ id: 5, action: "teleport" }),
  ] });
  assert.equal(items.length, 4, "an unknown action is ignored");
  assert.deepEqual(items.map((item) => item.no), [1, 2, 3, 4]);
  assert.equal(items[0].text, "เปลี่ยน RAM RAM-001 · Kingston 8GB เป็น RAM RAM-009 · Kingston 8GB · ชิ้นเดิมเป็นชำรุด");
  assert.match(items[1].text, /^ถอด RAM RAM-001 · Kingston 8GB ออก · เป็นยกเลิกใช้งาน$/);
  assert.match(items[2].text, /^ย้าย .* ไปเครื่อง COM02$/);
  assert.match(items[3].text, /^ติดตั้ง /);
  assert.equal(items[3].by, "IT3462", "falls back to the employee number when the name is missing");
  assert.match(items[0].atText, /25\/11\/2569/);
  assert.deepEqual(model.partChangeItems(null), []);
  assert.deepEqual(model.partChangeItems({ items: "x" }), []);
});

/* ---------- HTML ---------- */
test("the detail page reserves two hidden places that the module fills in later", () => {
  const html = pages.detailPage({ id: "00000000-0000-4000-8000-000000000001", doc_no: "IT01-26/050", status: "in_progress", is_test: false, requester: {}, department: {}, events: [], reworks: [], attachments: [], comments: [], allowed_actions: [], created_at: "2026-11-21T01:00:00Z" });
  assert.match(html, /<div id="itrp-partchg-apply" hidden><\/div><div id="itrp-partchg-history" hidden><\/div>/);
});

test("the card lists machines, groups parts by type and offers the right buttons per status", () => {
  const html = pages.partChangesCard({ ctx: ctx() });
  assert.match(html, /<h2 id="itrp-partchg-title">เปลี่ยน \/ ย้ายชิ้นส่วน<\/h2>/);
  assert.equal((html.match(/class="itrp-partchg-host"/g) ?? []).length, 2);
  assert.match(html, /data-host="COM01"[\s\S]*รหัสที่ผู้แจ้งกรอก/);
  assert.match(html, /data-host="COM09"[\s\S]*เครื่องที่ IT ระบุตอนส่งงาน/);
  assert.match(html, /ยังไม่มีชิ้นส่วนที่ผูกกับเครื่องนี้ในทะเบียน/);
  for (const action of ["replace", "remove", "move"]) {
    assert.match(html, new RegExp(`data-pc-act="${action}" data-pc-host="COM01" data-pc-asset="p1"`));
    assert.match(html, new RegExp(`data-pc-act="${action}" data-pc-host="COM01" data-pc-asset="p2"`), "a broken part can still be changed");
    assert.doesNotMatch(html, new RegExp(`data-pc-act="${action}" data-pc-host="COM01" data-pc-asset="p3"`), "a spare part has no change buttons");
  }
  assert.equal((html.match(/data-pc-act="install"/g) ?? []).length, 2, "one install button per machine");
  assert.match(html, /itrp-partchg-status is-broken">ชำรุด</);
  assert.match(html, /ยังไม่ได้เลือกรายการ/);
  assert.doesNotMatch(html, /data-pc-act="save"/);
});

test("a blocked request shows only the reason from the database", () => {
  const html = pages.partChangesCard({ ctx: ctx({ can_apply: false, blocked_reason: `ใบนี้ยังไม่มีรหัสเครื่อง ${XSS}` }) });
  assert.match(html, /ใบนี้ยังไม่มีรหัสเครื่อง &lt;img/);
  assert.doesNotMatch(html, /<img /);
  assert.doesNotMatch(html, /data-pc-act=/);
  assert.match(pages.partChangesCard({ ctx: ctx({ can_apply: false, blocked_reason: null }) }), /ยังบันทึกการเปลี่ยนชิ้นส่วนไม่ได้/);
  const closed = (status) => ctx({ request: { id: "r1", doc_no: "IT01-26/050", status }, can_apply: false, blocked_reason: "ใบนี้ยังไม่มีรหัสเครื่อง" });
  assert.match(pages.partChangesCard({ ctx: closed("it_closed") }), /ใบนี้ยังไม่มีรหัสเครื่อง/, "a sent-off request that cannot apply still shows the reason");
});

test("a card that cannot apply on a request that is not in progress or sent off is hidden completely", () => {
  for (const status of ["pending_dept", "it_approved", "received", "cancelled", "rejected", "need_info", ""]) {
    const value = ctx({ request: { id: "r1", doc_no: "IT01-26/050", status }, can_apply: false, blocked_reason: "ใบนี้ยังไม่ถึงขั้นทำงาน" });
    assert.equal(pages.partChangesCard({ ctx: value }), "", `status ${status || "(empty)"}`);
  }
  assert.notEqual(pages.partChangesCard({ ctx: ctx({ request: { id: "r1", doc_no: "x", status: "received" } }) }), "", "an applicable card is never hidden by this rule");
});

test("chosen rows appear in a summary with remove buttons, mark their parts as pending, and the failing row is highlighted", () => {
  const value = ctx();
  const rows = [model.cleanPartChange(REPLACE), model.cleanPartChange({ action: "remove", host_code: "COM01", asset_id: "p2", result_status: "broken" })];
  const html = pages.partChangesCard({ ctx: value, rows, errorRow: 2, message: '<div class="form-message error">แถวที่ 2: x</div>' });
  assert.match(html, /รายการที่เลือก <span class="detail-section-count">2\/20<\/span>/);
  assert.equal((html.match(/class="itrp-partchg-pending-row/g) ?? []).length, 2);
  assert.match(html, /itrp-partchg-pending-row is-error" data-pc-line="2"/);
  assert.doesNotMatch(html, /itrp-partchg-pending-row is-error" data-pc-line="1"/);
  assert.match(html, /data-pc-act="remove-row" data-pc-index="0"/);
  assert.match(html, /บันทึกการเปลี่ยนชิ้นส่วน \(2 รายการ\)/);
  assert.equal((html.match(/รอบันทึก/g) ?? []).length, 2, "both changed parts are marked pending");
  assert.doesNotMatch(html, /data-pc-act="replace" data-pc-host="COM01" data-pc-asset="p1"/, "a pending part has no buttons");
  assert.match(html, /แถวที่ 2: x/);
});

test("while saving every button is disabled and the card is marked busy", () => {
  const rows = [model.cleanPartChange(REPLACE)];
  const html = pages.partChangesCard({ ctx: ctx(), rows, busy: true });
  assert.match(html, /aria-busy="true"/);
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  assert.ok(buttons.length > 0);
  for (const button of buttons) assert.match(button, /disabled/);
});

test("the editor offers only same-type spares for a replace, and searchable spares of every type for an install", () => {
  const value = ctx();
  const replace = pages.partChangeEditor({ ctx: value, rows: [], editor: { action: "replace", host_code: "COM01", asset_id: "p1" }, busy: false });
  assert.match(replace, /<select class="select" id="itrp-pc-spare" name="new_asset_id" data-spare-type="RAM">/);
  assert.match(replace, /RAM-009/);
  assert.match(replace, /RAM-010/);
  assert.doesNotMatch(replace, /SSD-009/);
  assert.match(replace, /name="result_status"[\s\S]*value="broken" selected/);
  assert.match(replace, /name="slot"/);
  assert.match(replace, /ไม่กรอก = ใช้ช่องเดิม/);
  const install = pages.partChangeEditor({ ctx: value, rows: [], editor: { action: "install", host_code: "COM09", asset_id: "" }, busy: false });
  assert.match(install, /<optgroup label="RAM">[\s\S]*<optgroup label="SSD">/);
  assert.match(install, /name="asset_id"/);
  assert.doesNotMatch(install, /name="result_status"/);
  const remove = pages.partChangeEditor({ ctx: value, rows: [], editor: { action: "remove", host_code: "COM01", asset_id: "p2" }, busy: false });
  assert.match(remove, /name="result_status"/);
  assert.doesNotMatch(remove, /name="slot"|name="new_asset_id"/);
  const move = pages.partChangeEditor({ ctx: value, rows: [], editor: { action: "move", host_code: "COM01", asset_id: "p1" }, busy: false });
  assert.match(move, /name="to_host_code" list="itrp-pc-target-list"/);
  assert.match(move, /<option value="COM02" label="HP">/);
  assert.doesNotMatch(move, /<option value="COM01"/, "the same machine is not offered as a target");
  assert.match(move, /ไม่กรอก = ล้างช่องเดิม/);
});

test("the editor explains why nothing can be chosen instead of showing an empty list", () => {
  const noSpares = ctx({ spares: [] });
  const replace = pages.partChangeEditor({ ctx: noSpares, rows: [], editor: { action: "replace", host_code: "COM01", asset_id: "p1" }, busy: false });
  assert.match(replace, /ไม่มีชิ้นสำรองชนิด RAM ในทะเบียน/);
  assert.doesNotMatch(replace, /type="submit"/);
  assert.match(replace, /data-pc-act="editor-cancel"/);
  assert.match(pages.partChangeEditor({ ctx: noSpares, rows: [], editor: { action: "install", host_code: "COM01", asset_id: "" }, busy: false }), /ไม่มีชิ้นสำรองในทะเบียน/);
  assert.equal(pages.partChangeEditor({ ctx: noSpares, rows: [], editor: { action: "replace", host_code: "COM01", asset_id: "gone" }, busy: false }), "", "an editor for a part that vanished draws nothing");
});

test("the editor is drawn under the part it belongs to, or under the machine for an install", () => {
  const value = ctx();
  const replace = pages.partChangesCard({ ctx: value, editor: { action: "replace", host_code: "COM01", asset_id: "p1" } });
  assert.equal((replace.match(/id="itrp-partchg-editor"/g) ?? []).length, 1);
  assert.ok(replace.indexOf('data-asset="p1"') < replace.indexOf('id="itrp-partchg-editor"'));
  assert.ok(replace.indexOf('id="itrp-partchg-editor"') < replace.indexOf('data-asset="p2"'));
  const install = pages.partChangesCard({ ctx: value, editor: { action: "install", host_code: "COM09", asset_id: "" } });
  assert.ok(install.indexOf('data-host="COM09"') < install.indexOf('id="itrp-partchg-editor"'));
});

test("every value coming from the register is escaped", () => {
  const evil = part("p1", "RAM", XSS, { name: XSS, slot: XSS, serial: XSS, place: XSS });
  const value = ctx({ hosts: [{ host_code: "COM01", source: "request", device: { name: XSS }, parts: [evil] }], spares: [{ type_code: "RAM", type_name: XSS, items: [part("s1", "RAM", XSS, { status: "spare", host_code: null, name: XSS })] }], move_targets: [{ device_code: "COM02", name: XSS, type_code: "X" }] });
  const rows = [model.cleanPartChange({ ...REPLACE, slot: XSS, note: XSS })];
  const html = [
    pages.partChangesCard({ ctx: value, rows, message: "" }),
    pages.partChangesCard({ ctx: value, editor: { action: "replace", host_code: "COM01", asset_id: "p1" } }),
    pages.partChangesCard({ ctx: value, editor: { action: "move", host_code: "COM01", asset_id: "p1" } }),
    pages.partChangesCard({ ctx: value, editor: { action: "install", host_code: "COM01", asset_id: "" } }),
    pages.partChangesHistoryCard(model.partChangeItems({ items: [ITEM({ asset: { type_name: XSS, reg_no: XSS, name: XSS }, slot: XSS, note: XSS, actor_full_name: XSS, host_code: XSS })] })),
    pages.printPartChanges(model.partChangeItems({ items: [ITEM({ asset: { type_name: XSS, reg_no: XSS, name: XSS }, slot: XSS, note: XSS, actor_full_name: XSS, host_code: XSS })] })),
  ].join("\n");
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("the history card and the printed table appear only when there are rows", () => {
  assert.equal(pages.partChangesHistoryCard([]), "");
  assert.equal(pages.printPartChanges([]), "");
  const items = model.partChangeItems({ items: [ITEM(), ITEM({ id: 2, action: "move", to_host_code: "COM02", note: "ย้ายไปใช้ต่อ" })] });
  const card = pages.partChangesHistoryCard(items);
  assert.match(card, /ประวัติการเปลี่ยน \/ ย้ายชิ้นส่วน <span class="detail-section-count">2<\/span>/);
  assert.match(card, /data-label="วันเวลา">25\/11\/2569/);
  assert.match(card, /ช่อง DIMM1/);
  assert.match(card, /หมายเหตุ: ย้ายไปใช้ต่อ/);
  assert.match(card, /data-label="ผู้บันทึก">สุริยา</);
  const sheetOptions = { id: "r1", doc_no: "IT01-26/050", status: "it_closed", is_test: false, is_urgent: false, requester: { full_name: "ก" }, department: { name_th: "ข" }, events: [], reworks: [], attachments: [], comments: [], repair_reports: [], created_at: "2026-11-21T01:00:00Z" };
  assert.doesNotMatch(pages.printSheet(sheetOptions), /itrp-sheet-partchg/, "a request without changes prints exactly as before");
  assert.doesNotMatch(pages.printSheet(sheetOptions, { partChanges: [] }), /ประวัติการเปลี่ยน/);
  const printed = pages.printSheet(sheetOptions, { partChanges: items });
  assert.match(printed, /<h2 class="itrp-sheet-section">ประวัติการเปลี่ยน \/ ย้ายชิ้นส่วน<\/h2>/);
  assert.equal((printed.match(/<tr>\s*<td class="itrp-center">\d+<\/td>\s*<td>25\/11\/2569/g) ?? []).length, 2);
  assert.ok(printed.indexOf("itrp-sheet-partchg") < printed.indexOf("itrp-sheet-note"), "the table sits at the end of the sheet");
  assert.match(pages.printPage(sheetOptions, { partChanges: items }), /itrp-sheet-partchg/);
  assert.doesNotMatch(pages.printPage(sheetOptions), /itrp-sheet-partchg/);
});

test("the load-failed card offers a retry button", () => {
  assert.match(pages.partChangesLoadFailed(), /data-pc-act="reload"[^>]*>ลองอีกครั้ง</);
});
