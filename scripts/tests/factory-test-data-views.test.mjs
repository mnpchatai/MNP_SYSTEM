import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โหลดหน้า "จัดการข้อมูลทดสอบ" (script ธรรมดาใน browser) เข้า context จำลอง แล้วเรียก view จริงด้วย RPC จำลอง
// ปุ่มและแผงเป็นวัตถุจำลองขนาดเล็ก (ไม่มี DOM จริง) ตรวจ HTML ที่วาด ลำดับการเรียก RPC ข้อความ toast และสถานะปุ่ม
const FILES = ["modules/factory-item-master.js", "modules/factory-test-data-model.js", "modules/module-factory-test-data.js"];

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const EMPTY = { counts: {}, total: 0, sets: { sample_available: true, trial_loaded: false, megaform_loaded: false } };
const TRIAL = {
  counts: { items: 27, boms: 17, routings: 17, production_orders: 2, material_orders: 0, jobs: 0, inventory_movements: 30, lots: 4, attachments: 3, work_centers: 8, warehouses: 4, details: 1052 },
  total: 1164,
  sets: { sample_available: false, trial_loaded: true, megaform_loaded: false },
};

function element(extra = {}) {
  return {
    disabled: false, hidden: false, innerHTML: "", dataset: {}, handlers: {}, focused: 0,
    addEventListener(type, handler) { this.handlers[type] = handler; },
    focus() { this.focused += 1; },
    ...extra,
  };
}

// summaries: คิวผลลัพธ์ของ app_sandbox_factory_test_data ทีละครั้ง (ครั้งแรก = ตอนเปิดหน้า)
function setup({ summaries = [EMPTY], rpc = {}, removeAll } = {}) {
  const calls = [];
  const toasts = [];
  const queue = [...summaries];
  const state = { renders: 0 };
  const context = vm.createContext({});
  context.window = context;
  Object.assign(context, {
    escapeHtml,
    URLSearchParams,
    showToast: (message, kind) => toasts.push([message, kind ?? "ok"]),
    friendlyError: (error) => String(error?.message ?? error),
    renderRoute: async () => { state.renders += 1; },
    sb: {
      rpc: async (name) => {
        calls.push(name);
        if (name === "app_sandbox_factory_test_data") {
          const next = queue.length > 1 ? queue.shift() : queue[0];
          return next instanceof Error ? { data: null, error: next } : { data: next, error: null };
        }
        return rpc[name] ?? { data: null, error: { message: `unexpected ${name}` } };
      },
    },
    MNP_FACTORY_ATTACHMENTS: { removeAll: removeAll ?? (async () => { calls.push("removeAll"); return 0; }) },
  });
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return { context, calls, toasts, state };
}

// เปิดหน้าแล้วคืน body ที่วาดพร้อมปุ่มจำลองที่ผูก event ไว้
async function open(options = {}) {
  const env = setup(options);
  let body = "";
  const seedButtons = env.context.MNP_FACTORY_TEST_DATA_MODEL.SETS.map((set) => element({ dataset: { seed: set.key } }));
  const review = element();
  const cancel = element();
  const confirm = element();
  const heading = element();
  const panel = element({ hidden: true, querySelector: (selector) => ({ h3: heading, "#ftd-cancel": cancel, "#ftd-confirm": confirm })[selector] ?? null });
  const root = {
    querySelector: (selector) => ({ "#ftd-review": body.includes('id="ftd-review"') ? review : null, "#ftd-review-panel": panel })[selector] ?? null,
    querySelectorAll: (selector) => (selector === "[data-seed]" ? seedButtons.filter((button) => body.includes(`data-seed="${button.dataset.seed}"`)) : []),
  };
  const frame = { loading: () => {}, paint: (options) => { body = options.body; return root; } };
  await env.context.MNP_FACTORY_VIEWS["test-data"]({ params: new URLSearchParams(""), frame });
  return { ...env, body, seedButtons, review, panel, cancel, confirm, heading };
}

test("the view is registered next to the other factory views", () => {
  const { context } = setup();
  assert.equal(typeof context.MNP_FACTORY_VIEWS["test-data"], "function");
});

test("an empty test mode teaches the next step and offers every set", async () => {
  const { body, seedButtons } = await open({ summaries: [EMPTY] });
  assert.match(body, /<h2 id="ftd-status-title">ยังไม่มีข้อมูลทดสอบ<\/h2>/);
  assert.match(body, /เริ่มจากเติมชุดข้อมูลตัวอย่างด้านล่าง/);
  assert.equal((body.match(/class="ftd-count is-zero"/g) ?? []).length, 12, "all twelve groups show, at zero");
  assert.equal(seedButtons.filter((button) => body.includes(`data-seed="${button.dataset.seed}"`)).length, 3);
  assert.match(body, /data-seed="sample">เติมชุดตัวอย่าง<\/button>/);
  assert.equal((body.match(/badge ftd-state-ready/g) ?? []).length, 3);
  assert.match(body, /ไม่มีข้อมูลทดสอบให้ล้าง/);
  assert.doesNotMatch(body, /id="ftd-review"/, "there is nothing to review");
});

test("loaded data shows counts, the loaded set links to its page, and the empty-only set explains why it waits", async () => {
  const { body } = await open({ summaries: [TRIAL] });
  assert.match(body, /มีข้อมูลทดสอบ 1,164 แถว/);
  assert.match(body, /<dt>Item สินค้า<\/dt><dd><strong>27<\/strong> <span>รายการ<\/span><\/dd>/);
  assert.match(body, /<dt>รายการย่อยและประวัติ<\/dt><dd><strong>1,052<\/strong>/);
  assert.match(body, /<h3>ชุดทดลอง 5 สินค้า<\/h3><span class="badge ftd-state-loaded">เติมแล้ว<\/span>/);
  assert.match(body, /href="#\/factory\?item=production-view">เปิดใบสั่งผลิต →<\/a>/);
  assert.doesNotMatch(body, /data-seed="trial"/);
  assert.match(body, /<span class="badge ftd-state-blocked">ต้องล้างก่อน<\/span>/);
  assert.match(body, /ทะเบียนสินค้าต้องว่างก่อน/);
  assert.match(body, /data-seed="megaform">เติมชุด MEGAFORM<\/button>/);
  assert.match(body, /id="ftd-review">ตรวจรายการที่จะลบ<\/button>/);
  assert.match(body, /<div class="ftd-review" id="ftd-review-panel" hidden><\/div>/, "the review panel starts closed");
});

test("a seed button calls the RPC of its set, reports the result and reloads", async () => {
  const page = await open({ summaries: [EMPTY], rpc: { app_sandbox_seed_factory_megaform: { data: { seeded: true, items: 355, boms: 229, steps: 1896, orders: 14, jobs: 173 }, error: null } } });
  const button = page.seedButtons.find((candidate) => candidate.dataset.seed === "megaform");
  await button.handlers.click({ currentTarget: button });
  assert.deepEqual(page.calls, ["app_sandbox_factory_test_data", "app_sandbox_seed_factory_megaform"]);
  assert.deepEqual(page.toasts, [["เติมชุด MEGAFORM แล้ว 355 Item · 229 BOM · ใบสั่งผลิต 14 ใบ · ใบงาน 173 ใบ", "ok"]]);
  assert.equal(page.state.renders, 1);
  assert.equal(button.disabled, true, "the button stays disabled until the page is redrawn");
});

test("a failed seed re-enables its button, and a tampered seed key calls nothing", async () => {
  const page = await open({ summaries: [EMPTY], rpc: { app_sandbox_seed_factory_trial: { data: null, error: { message: "SANDBOX_NOT_ACTIVE" } } } });
  const trial = page.seedButtons.find((candidate) => candidate.dataset.seed === "trial");
  await trial.handlers.click({ currentTarget: trial });
  assert.deepEqual(page.toasts, [["SANDBOX_NOT_ACTIVE", "error"]]);
  assert.equal(trial.disabled, false);
  assert.equal(page.state.renders, 0);
  const sample = page.seedButtons.find((candidate) => candidate.dataset.seed === "sample");
  sample.dataset.seed = "app_sandbox_purge_factory";
  await sample.handlers.click({ currentTarget: sample });
  assert.deepEqual(page.calls, ["app_sandbox_factory_test_data", "app_sandbox_seed_factory_trial"], "an unknown key never reaches an RPC");
});

test("review loads fresh counts and shows the plan before anything is deleted", async () => {
  const fresher = { ...TRIAL, counts: { ...TRIAL.counts, items: 30 } };
  const page = await open({ summaries: [TRIAL, fresher] });
  await page.review.handlers.click();
  assert.deepEqual(page.calls, ["app_sandbox_factory_test_data", "app_sandbox_factory_test_data"], "only the summary is read; nothing is purged yet");
  assert.equal(page.panel.hidden, false);
  assert.equal(page.review.hidden, true);
  assert.equal(page.heading.focused, 1, "focus moves to the plan so keyboard and screen reader users land on it");
  assert.match(page.panel.innerHTML, /รายการที่จะลบ 1,167 แถว/, "the plan uses the counts loaded on review, not on page open");
  assert.match(page.panel.innerHTML, /<th scope="row">Item สินค้า<\/th><td class="right"><strong>30<\/strong> รายการ<\/td>/);
  assert.doesNotMatch(page.panel.innerHTML, /<th scope="row">ใบสั่งวัตถุดิบ<\/th>/, "groups with nothing to delete are left out");
  assert.match(page.panel.innerHTML, /ลบไฟล์แนบ 3 ไฟล์ออกจาก Storage ก่อน/);
  assert.match(page.panel.innerHTML, /id="ftd-confirm">ยืนยันล้าง 1,167 แถว<\/button>/);
});

test("confirm removes stored files first, then purges, reports the counts and reloads", async () => {
  const page = await open({ summaries: [TRIAL], rpc: { app_sandbox_purge_factory: { data: { deleted: 27, counts: TRIAL.counts }, error: null } } });
  await page.review.handlers.click();
  await page.confirm.handlers.click();
  assert.deepEqual(page.calls, ["app_sandbox_factory_test_data", "app_sandbox_factory_test_data", "removeAll", "app_sandbox_purge_factory"]);
  assert.deepEqual(page.toasts, [["ล้างข้อมูลทดสอบแล้ว Item สินค้า 27 · โครงสร้างสินค้า (BOM) 17 · ขั้นตอนการผลิต (Routing) 17 และอื่น ๆ อีก 1,103 แถว", "ok"]]);
  assert.equal(page.state.renders, 1);
  assert.equal(page.confirm.disabled, true);
  assert.equal(page.cancel.disabled, true);
});

test("a failed file removal or purge keeps the plan open with both buttons usable", async () => {
  const page = await open({
    summaries: [TRIAL],
    removeAll: async () => { throw new Error("FACTORY_FILES_REMAIN"); },
    rpc: { app_sandbox_purge_factory: { data: { deleted: 1 }, error: null } },
  });
  await page.review.handlers.click();
  await page.confirm.handlers.click();
  assert.ok(!page.calls.includes("app_sandbox_purge_factory"), "nothing is purged while files remain");
  assert.deepEqual(page.toasts, [["FACTORY_FILES_REMAIN", "error"]]);
  assert.equal(page.confirm.disabled, false);
  assert.equal(page.cancel.disabled, false);
  assert.equal(page.panel.hidden, false);
  assert.equal(page.state.renders, 0);
});

test("cancel closes the plan and returns focus to the review button", async () => {
  const page = await open({ summaries: [TRIAL] });
  await page.review.handlers.click();
  page.cancel.handlers.click();
  assert.equal(page.panel.hidden, true);
  assert.equal(page.panel.innerHTML, "");
  assert.equal(page.review.hidden, false);
  assert.equal(page.review.disabled, false);
  assert.equal(page.review.focused, 1);
});

test("review says so when another window already purged, and a failed review keeps the button usable", async () => {
  const gone = await open({ summaries: [TRIAL, EMPTY] });
  await gone.review.handlers.click();
  assert.match(gone.panel.innerHTML, /ไม่มีข้อมูลทดสอบให้ล้างแล้ว/);
  assert.doesNotMatch(gone.panel.innerHTML, /id="ftd-confirm"/);
  const failed = await open({ summaries: [TRIAL, Object.assign(new Error("NOT_AUTHORIZED"), { code: "P0001" })] });
  await failed.review.handlers.click();
  assert.deepEqual(failed.toasts, [["NOT_AUTHORIZED", "error"]]);
  assert.equal(failed.review.disabled, false);
  assert.equal(failed.panel.hidden, true);
});

test("a database without the summary RPC gets a clear message instead of a broken page", async () => {
  const missing = await open({ summaries: [Object.assign(new Error("Could not find the function"), { code: "PGRST202" })] });
  assert.match(missing.body, /ฐานข้อมูลยังไม่ได้อัปเดตสำหรับหน้านี้/);
  const denied = await open({ summaries: [new Error("SANDBOX_NOT_ACTIVE")] });
  assert.match(denied.body, /<div class="empty">SANDBOX_NOT_ACTIVE<\/div>/);
});

test("the migration raises only errors the pilot already words", () => {
  const sql = fs.readFileSync("supabase/migrations/20261014030000_factory_sandbox_test_data_summary.sql", "utf8");
  const raised = [...new Set([...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map((match) => match[1]))].sort();
  assert.deepEqual(raised, ["FACTORY_FILES_REMAIN", "SANDBOX_NOT_ACTIVE"]);
  assert.match(fs.readFileSync("app.js", "utf8"), /SANDBOX_NOT_ACTIVE: "/);
  assert.match(fs.readFileSync("modules/factory-attachments.js", "utf8"), /FACTORY_FILES_REMAIN: "/);
});
