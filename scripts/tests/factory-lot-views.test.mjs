import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { ATTACHMENT_STUBS } from "./support/factory-attachment-stubs.mjs";

// โหลดหน้า "ล็อตวัตถุดิบ" (script ธรรมดาใน browser) เข้า context จำลอง แล้วเรียก view จริงด้วยข้อมูล app_factory_lots จำลอง
// ตรวจ HTML ที่วาด (ลำดับ FEFO สถานะ ฟอร์มตามสิทธิ์ ประวัติ) การส่ง RPC จากฟอร์ม การตรวจก่อนส่ง และข้อความผิดพลาด (ไม่มี DOM จริง)
const FILES = [
  "modules/factory-departments.js",
  "modules/factory-item-master.js",
  "modules/factory-master-model.js",
  "modules/factory-production-model.js",
  "modules/factory-material-model.js",
  "modules/factory-job-model.js",
  "modules/factory-lot-model.js",
  "modules/module-factory-master.js",
  "modules/factory-attachments.js",
  "modules/module-factory-bom.js",
  "modules/module-factory-production.js",
  "modules/module-factory-material.js",
  "modules/module-factory-job.js",
  "modules/module-factory-lots.js",
];

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const XSS = "<script>alert(1)</script>";

const lot = (lotNumber, extra = {}) => ({ id: `id-${lotNumber}`, version: 3, lot_number: lotNumber, item_id: "i1", item_code: "RM-NR", item_name: `ยางธรรมชาติ ${XSS}`,
  unit_code: "KG", received_date: "2026-10-01", expiry_date: null, on_hold: false, hold_reason: "", status: "available", balance: 12.5, updated_at: null, updated_by_name: null, ...extra });
const FIXTURE = {
  today: "2026-10-28",
  can_set_expiry: false,
  can_hold: false,
  lots: [
    lot("LOT-A", { expiry_date: "2026-11-10" }),
    lot("LOT-B", { expiry_date: "2027-03-01" }),
    lot("LOT-H", { on_hold: true, hold_reason: `MDR ไม่ผ่าน ${XSS}`, status: "hold" }),
    lot("LOT-X", { expiry_date: "2026-10-20", status: "expired" }),
    lot("LOT-EMPTY", { balance: 0 }),
  ],
  history: [
    { id: "h2", lot_id: "id-LOT-H", lot_number: "LOT-H", item_code: "RM-NR", action: "hold", expiry_before: null, expiry_after: null, note: `เหตุผล ${XSS}`, created_at: "2026-10-28T03:00:00Z", changed_by_name: "ทดสอบ QA" },
    { id: "h1", lot_id: "id-LOT-A", lot_number: "LOT-A", item_code: "RM-NR", action: "expiry", expiry_before: null, expiry_after: "2026-11-10", note: "", created_at: "2026-10-27T03:00:00Z", changed_by_name: "ทดสอบ ST" },
  ],
};

function loadFactory({ data = FIXTURE, rpc } = {}) {
  const calls = [];
  const toasts = [];
  const log = { calls, toasts, renders: 0 };
  const context = vm.createContext({});
  context.window = context;
  Object.assign(context, {
    ...ATTACHMENT_STUBS,
    escapeHtml,
    formatDate: (value, withTime) => `d(${value ?? "—"}${withTime ? " t" : ""})`,
    showToast: (message, kind) => toasts.push([message, kind ?? "ok"]),
    friendlyError: (error) => context.MNP_FACTORY_ERRORS[Object.keys(context.MNP_FACTORY_ERRORS).find((key) => String(error?.message ?? error).includes(key))] ?? String(error?.message ?? error),
    renderRoute: async () => { log.renders += 1; },
    location: { hash: "" },
    Intl, URLSearchParams,
    FormData: class { constructor(form) { this.values = form.__values ?? {}; } get(key) { return [].concat(this.values[key] ?? [])[0] ?? null; } getAll(key) { return [].concat(this.values[key] ?? []); } },
    sb: { rpc: async (name, args) => { calls.push([name, args]); return rpc ? rpc(name, args) : { data: name === "app_factory_lots" ? data : { ok: true }, error: null }; } },
  });
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return { context, log };
}

const element = (extra = {}) => ({ handlers: {}, dataset: {}, disabled: false, addEventListener(type, handler) { this.handlers[type] = handler; }, ...extra });
// root จำลอง: forms = ฟอร์มของแถว (form[data-lot-form]) ปุ่มของทุกฟอร์มรวมกัน
async function render({ query = "", forms = [], ...options } = {}) {
  const { context, log } = loadFactory(options);
  let painted = null;
  const buttons = forms.map(() => element());
  const root = { querySelectorAll: (selector) => (selector === "form[data-lot-form]" ? forms : selector === "form[data-lot-form] button" ? buttons : []) };
  const frame = { loading: () => {}, paint: (opts) => { painted = opts; return root; } };
  await context.MNP_FACTORY_VIEWS.lots({ params: new URLSearchParams(query), frame });
  return { body: painted.body, log, context, buttons };
}
const form = (kind, lotId, values) => element({ dataset: { lotForm: kind, lotId }, __values: values });
const submit = (target) => target.handlers.submit({ preventDefault() {} });
const text = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("every error code the lot migration can raise has a Thai message that is not hidden by another key", () => {
  const sql = fs.readFileSync("supabase/migrations/20261030010000_factory_lot_fefo_quarantine.sql", "utf8");
  // app_sandbox_purge_factory ถูกคัดลอกมาทั้งฟังก์ชัน รหัสของมันแสดงที่หน้าจัดการข้อมูลทดสอบ (module-factory-test-data.js)
  const purgeOnly = new Set(["SANDBOX_NOT_ACTIVE", "FACTORY_FILES_REMAIN"]);
  const codes = [...new Set([...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map((match) => match[1]))].filter((code) => !purgeOnly.has(code));
  assert.ok(codes.length >= 10, `found ${codes.length} codes`);
  const messages = loadFactory().context.MNP_FACTORY_ERRORS;
  for (const code of codes) assert.ok(messages[code], `${code} has no message`);
  const keys = Object.keys(messages);
  for (const key of keys) assert.equal(keys.find((candidate) => key.includes(candidate)), key, `${key} would be shown as another message`);
});

test("the lots view is registered and the inventory folder lists it", () => {
  const { context } = loadFactory();
  assert.equal(typeof context.MNP_FACTORY_VIEWS.lots, "function");
  const folder = context.MNP_FACTORY_ITEM_MASTER.FOLDERS.find((entry) => entry.key === "inventory");
  assert.ok(folder.entries.some((entry) => entry.view === "lots"));
});

test("a read-only persona sees the lots in FEFO order with their status and no forms", async () => {
  const { body, log } = await render();
  assert.deepEqual(log.calls.map(([name]) => name), ["app_factory_lots"]);
  assert.deepEqual([...body.matchAll(/<td><strong>(LOT-[A-Z]+)<\/strong>/g)].map((match) => match[1]), ["LOT-A", "LOT-B", "LOT-H", "LOT-X"]);
  assert.ok(!body.includes("LOT-EMPTY"), "a lot without stock is hidden");
  const words = text(body);
  assert.match(words, /LOT-A RM-NR .* 12\.5 KG d\(2026-10-01\) d\(2026-11-10\) ใกล้หมดอายุ/);
  assert.match(words, /LOT-X .* หมดอายุ/);
  assert.match(words, /ดูได้อย่างเดียว/);
  assert.ok(!body.includes("data-lot-form"));
  assert.ok(!body.includes("<th>จัดการ</th>"));
  assert.ok(!body.includes(XSS));
  assert.ok(body.includes(escapeHtml(`MDR ไม่ผ่าน ${XSS}`)));
  // ประวัติ: วันหมดอายุแสดงก่อน → หลัง การกักกันแสดงเหตุผล
  assert.match(words, /วันหมดอายุ LOT-A · RM-NR · — → d\(2026-11-10\)/);
  assert.match(words, /กักกัน LOT-H · RM-NR · เหตุผล/);
});

test("the status filter and the search come from the URL", async () => {
  const held = await render({ query: "status=hold" });
  assert.deepEqual([...held.body.matchAll(/<td><strong>(LOT-[A-Z]+)<\/strong>/g)].map((match) => match[1]), ["LOT-H"]);
  assert.match(held.body, /<option value="hold" selected>/);
  const none = await render({ query: "q=ไม่มีแน่นอน" });
  assert.match(none.body, /ไม่มีล็อตที่ตรงกับตัวกรอง/);
});

test("stores get the expiry form only, and it sends the date or clears it", async () => {
  const data = { ...FIXTURE, can_set_expiry: true };
  const forms = [form("expiry", "id-LOT-A", { expiry: "2026-12-31" }), form("expiry", "id-LOT-B", { expiry: "" }), form("expiry", "id-LOT-A", { expiry: "2026-09-01" })];
  const { body, log } = await render({ data, forms });
  assert.match(body, /data-lot-form="expiry" data-lot-id="id-LOT-A"/);
  assert.match(body, /<input class="input" id="lot-exp-id-LOT-A" name="expiry" type="date" min="2026-10-28" max="2100-12-31" value="2026-11-10">/);
  assert.ok(!body.includes('data-lot-form="hold"') && !body.includes('data-lot-form="release"'));
  await submit(forms[0]);
  await submit(forms[1]);
  await submit(forms[2]);
  assert.deepEqual(JSON.parse(JSON.stringify(log.calls.slice(1))), [
    ["app_factory_set_lot_expiry", { p_id: "id-LOT-A", p_version: 3, p_expiry_date: "2026-12-31" }],
    ["app_factory_set_lot_expiry", { p_id: "id-LOT-B", p_version: 3, p_expiry_date: null }],
  ]);
  assert.deepEqual(log.toasts, [["บันทึกวันหมดอายุของ LOT-A", "ok"], ["ล้างวันหมดอายุของ LOT-B", "ok"], ["วันหมดอายุต้องไม่ก่อนวันที่รับของ", "error"]]);
  assert.equal(log.renders, 2);
});

test("QA holds an available lot and releases a held one, with a reason checked before sending", async () => {
  const data = { ...FIXTURE, can_set_expiry: true, can_hold: true };
  const forms = [form("hold", "id-LOT-A", { note: "สั้น" }), form("hold", "id-LOT-A", { note: "ผล MDR ไม่ผ่าน รอตรวจซ้ำ" }), form("release", "id-LOT-H", { note: "ตรวจซ้ำผ่านแล้ว ปล่อยใช้" })];
  const { body, log } = await render({ data, forms });
  assert.match(body, /data-lot-form="hold" data-lot-id="id-LOT-A"/);
  assert.match(body, /data-lot-form="release" data-lot-id="id-LOT-H"/);
  assert.ok(!body.includes('data-lot-form="release" data-lot-id="id-LOT-A"'));
  await submit(forms[0]);
  assert.equal(log.calls.length, 1, "a short reason is not sent");
  assert.match(log.toasts[0][0], /10–1,000/);
  await submit(forms[1]);
  await submit(forms[2]);
  assert.deepEqual(JSON.parse(JSON.stringify(log.calls.slice(1))), [
    ["app_factory_set_lot_hold", { p_id: "id-LOT-A", p_version: 3, p_hold: true, p_note: "ผล MDR ไม่ผ่าน รอตรวจซ้ำ" }],
    ["app_factory_set_lot_hold", { p_id: "id-LOT-H", p_version: 3, p_hold: false, p_note: "ตรวจซ้ำผ่านแล้ว ปล่อยใช้" }],
  ]);
  assert.deepEqual(log.toasts.slice(1), [["กักกันล็อต LOT-A", "ok"], ["ปลดกักกันล็อต LOT-H", "ok"]]);
});

test("a stale lot redraws the page, another error keeps the form and turns the buttons back on", async () => {
  const data = { ...FIXTURE, can_hold: true };
  const errorFor = (code) => (name) => (name === "app_factory_lots" ? { data, error: null } : { data: null, error: { message: code } });
  const run = async (code) => {
    const forms = [form("hold", "id-LOT-A", { note: "เหตุผลยาวพอสำหรับทดสอบ" })];
    const result = await render({ data, forms, rpc: errorFor(code) });
    await submit(forms[0]);
    return result;
  };
  const staleRun = await run("LOT_STALE");
  assert.deepEqual(staleRun.log.toasts, [["ล็อตนี้ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว กรุณาตรวจข้อมูลล่าสุดแล้วทำอีกครั้ง", "error"]]);
  assert.equal(staleRun.log.renders, 1);
  const denied = await run("LOT_HOLD_QA_ONLY");
  assert.match(denied.log.toasts[0][0], /เฉพาะแผนก QA/);
  assert.equal(denied.log.renders, 0);
  assert.equal(denied.buttons[0].disabled, false);
});

test("the job page explains a start blocked by held or expired lots", () => {
  const messages = loadFactory().context.MNP_FACTORY_ERRORS;
  assert.match(messages.JOB_STOCK_LOT_BLOCKED, /กักกันหรือหมดอายุ/);
  assert.notEqual(messages.JOB_STOCK_LOT_BLOCKED, messages.JOB_INSUFFICIENT_STOCK);
});
