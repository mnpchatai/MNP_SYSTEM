import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const model = require("../../modules/mt-dashboard-model.js");
const source = readFileSync(new URL("../../modules/module-mt-dashboard.js", import.meta.url), "utf8");
const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

async function render({ status = "assigned", technicians = ["t1"], directory, overdue = false } = {}) {
  const root = { innerHTML: "", addEventListener() {}, querySelector: () => null };
  const mtModule = {};
  const request = {
    id: "r1", request_no: "TEST-MT-001", status, current_step: 1, doc_type: "repair",
    submitted_at: "2026-10-01T02:00:00Z", department: { code: "MT" },
    work_expected_date: overdue ? "2026-10-02" : "2026-10-15",
    request_technicians: technicians.map((id) => ({ technician_id: id })),
  };
  const query = {
    select() { return this; }, eq() { return this; }, order() { return this; },
    maybeSingle: async () => ({ data: { id: "type-mt" } }),
    range: async () => ({ data: [request] }),
  };
  const context = vm.createContext({
    window: {
      MNP_REQUEST_MODULES: { MT_REPAIR: mtModule }, MNP_MT_DASHBOARD: model,
      MNP_REQUEST_CENTER: { url: () => "#/requests" }, scrollY: 0, scrollTo() {},
    },
    document: { getElementById: () => root, activeElement: null },
    sb: { from: () => query }, state: { employee: { id: "viewer" } },
    app: { innerHTML: "" }, shell: (html) => html, bindShell() {}, loadingShell() {},
    escapeHtml, relation: (value) => value, bangkokToday: () => "2026-10-10",
    formatDate: (value) => value, statusBadge: (value) => `<span class="badge">${value}</span>`,
    loadEmployeeDirectory: async () => directory ?? new Map([["t1", { first_name: "สมชาย", last_name: "ใจดี" }]]),
    URLSearchParams, console,
  });
  vm.runInContext(source, context);
  await mtModule.pages["mt-dashboard"](new URLSearchParams("year=2026"));
  return root.innerHTML.split('id="nd-drill"')[1].split("</section>")[0];
}

test("waiting and in-progress MT requests show the assigned technician below their status", async () => {
  for (const status of ["assigned", "in_progress"]) {
    const html = await render({ status, overdue: true });
    assert.match(html, /ช่างผู้รับผิดชอบ: สมชาย ใจดี/);
    assert.match(html, /เลยกำหนด/);
    assert.match(html, /href="#\/request\?id=r1"/);
  }
});

test("all assignees appear once and technician names are escaped", async () => {
  const html = await render({
    technicians: ["t1", "t2", "t1"],
    directory: new Map([
      ["t1", { first_name: "สมชาย", last_name: "ใจดี" }],
      ["t2", { first_name: "<img src=x onerror=alert(1)>", last_name: "&ทีม" }],
    ]),
  });
  assert.match(html, /ช่างผู้รับผิดชอบ: สมชาย ใจดี, &lt;img src=x onerror=alert\(1\)&gt; &amp;ทีม/);
  assert.equal(html.match(/สมชาย ใจดี/g).length, 1);
  assert.doesNotMatch(html, /<img/);
});

test("missing assignment or directory data has a clear fallback", async () => {
  assert.match(await render({ technicians: [] }), /ช่างผู้รับผิดชอบ: ไม่พบข้อมูลช่างที่รับผิดชอบ/);
  assert.match(await render({ directory: new Map() }), /ช่างผู้รับผิดชอบ: ช่าง \(ไม่พบชื่อ\)/);
});

test("requests waiting on other workflow participants do not claim a technician owns the work", async () => {
  for (const status of ["pending_approval", "more_info", "pending_assign", "pending_verify", "completed", "rejected"]) {
    assert.doesNotMatch(await render({ status }), /ช่างผู้รับผิดชอบ:/);
  }
});
