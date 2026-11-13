// กติกาของคิวงานหน้าหลัก (modules/home-queue.js)
import { test } from "node:test";
import assert from "node:assert/strict";

await import("../../modules/home-queue.js");
const queue = globalThis.MNP_HOME_QUEUE;

test("urgent comes first, then high, then the rest; oldest first within each group", () => {
  const items = [
    { id: "normal-old", priority: "normal", createdAt: "2026-10-01T03:00:00Z" },
    { id: "high-new", priority: "high", createdAt: "2026-11-02T03:00:00Z" },
    { id: "urgent-new", priority: "urgent", createdAt: "2026-11-03T03:00:00Z" },
    { id: "urgent-old", priority: "urgent", createdAt: "2026-11-01T03:00:00Z" },
    { id: "low", priority: "low", createdAt: "2026-09-01T03:00:00Z" },
    { id: "none", priority: undefined, createdAt: "2026-10-15T03:00:00Z" },
  ];
  assert.deepEqual(queue.sortQueue(items).map((item) => item.id), ["urgent-old", "urgent-new", "high-new", "low", "normal-old", "none"]);
  assert.equal(items[0].id, "normal-old", "the input array is not reordered");
});

test("waiting days count Thai calendar days, not 24-hour blocks", () => {
  // 23:30 ของวันที่ 2 กับ 00:30 ของวันที่ 3 เวลาไทย ห่างกันชั่วโมงเดียวแต่ต่างวัน
  const sentLateNight = "2026-11-02T16:30:00Z"; // 23:30 ไทย
  const nextMorning = Date.parse("2026-11-02T17:30:00Z"); // 00:30 ไทยของวันที่ 3
  assert.equal(queue.waitingDays(sentLateNight, nextMorning), 1);
  assert.equal(queue.waitingDays("2026-11-03T01:00:00Z", Date.parse("2026-11-03T10:00:00Z")), 0);
  assert.equal(queue.waitingDays("2026-10-30T01:00:00Z", Date.parse("2026-11-03T01:00:00Z")), 4);
  assert.equal(queue.waitingDays(null), 0);
  assert.equal(queue.waitingDays("2026-11-05T01:00:00Z", Date.parse("2026-11-03T01:00:00Z")), 0, "never negative");
});

test("waiting labels read naturally", () => {
  assert.equal(queue.waitingLabel(0), "ส่งวันนี้");
  assert.equal(queue.waitingLabel(1), "ค้าง 1 วัน");
  assert.equal(queue.waitingLabel(12), "ค้าง 12 วัน");
});

test("selection prefers the requested item, then the open one, then the first", () => {
  const ids = ["a", "b", "c"];
  assert.equal(queue.pickSelection(ids, { requested: "c", current: "b" }), "c");
  assert.equal(queue.pickSelection(ids, { requested: "gone", current: "b" }), "b");
  assert.equal(queue.pickSelection(ids, { requested: null, current: "gone" }), "a");
  assert.equal(queue.pickSelection([], { requested: "a" }), null);
});

test("J/K moves one item and stops at the ends", () => {
  const ids = ["a", "b", "c"];
  assert.equal(queue.stepSelection(ids, "a", 1), "b");
  assert.equal(queue.stepSelection(ids, "c", 1), "c");
  assert.equal(queue.stepSelection(ids, "a", -1), "a");
  assert.equal(queue.stepSelection(ids, "gone", 1), "a");
  assert.equal(queue.stepSelection([], "a", 1), null);
});

test("each request status has one name, shared by badges, filters, progress, timeline and the MT dashboard", async () => {
  // ผลประเมินดีไซน์: สถานะเดียวกันเคยมีสามชื่อ (รอเริ่มงาน / รอดำเนินการ / รอช่างเริ่มงาน) — ตรวจย้อนหลังไม่ได้ถ้าชื่อไม่ตรงกัน
  const { readFileSync } = await import("node:fs");
  const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const app = read("app.js");
  const labels = Object.fromEntries([...app.match(/const statusLabels = \{([\s\S]*?)\};/)[1].matchAll(/(\w+): "([^"]+)"/g)].map((match) => [match[1], match[2]]));
  assert.equal(labels.assigned, "รอช่างเริ่มงาน");
  assert.equal(labels.pending_verify, "รอผู้แจ้งตรวจรับ");
  assert.equal(labels.pending_assign, "รอมอบหมายช่าง");
  // ตัวกรองและแถบความคืบหน้าอ่านจาก statusLabels ไม่มีรายการชื่อของตัวเอง
  assert.match(app, /const REQUEST_STATUS_FILTERS = \[\s*\["all", "ทั้งหมด"\],\s*\.\.\.\[/);
  assert.match(app, /const REPAIR_STAGES = \[[^\]]*\]\s*\.map\(\(status\) => \(\{ status, label: statusLabel\(status, true\) \}\)\);/);
  assert.doesNotMatch(app, /repairTimelineStatusLabels|"รอดำเนินการ"|"รอผู้แจ้งตรวจสอบ"/);
  // แดชบอร์ด MT ใช้ชื่อเดียวกันในขั้นที่ตรงกัน
  const dashboard = read("modules/mt-dashboard-model.js");
  for (const [key, status] of [["assign", "pending_assign"], ["start", "assigned"], ["verify", "pending_verify"]]) {
    assert.match(dashboard, new RegExp(`key: "${key}", label: "${labels[status]}", short: "${labels[status]}"`), `${key} on the dashboard reads ${labels[status]}`);
  }
});

test("the label functions give repair requests their own words and everything else the shared ones", async () => {
  // ดึงส่วนป้ายจาก app.js (ตั้งแต่ statusLabels ถึง priorityLabel) มารันจริงใน vm แทนการเทียบข้อความ
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  const app = readFileSync(new URL("../../app.js", import.meta.url), "utf8");
  const start = app.indexOf("const statusLabels = {");
  const endMarker = "function priorityLabel(";
  const end = app.indexOf("\n}", app.indexOf(endMarker)) + 2;
  assert.ok(start >= 0 && end > start, "label block found in app.js");
  const context = vm.createContext({});
  vm.runInContext(`${app.slice(start, end)}\nthis.api = { statusLabel, priorityLabel, isRepairType };`, context);
  const { statusLabel, priorityLabel, isRepairType } = context.api;
  assert.equal(statusLabel("in_progress", true), "กำลังซ่อม");
  assert.equal(statusLabel("in_progress", false), "กำลังดำเนินการ", "management and IT requests keep the general word");
  assert.equal(statusLabel("assigned", true), "รอช่างเริ่มงาน");
  assert.equal(statusLabel("pending_verify", true), "รอผู้แจ้งตรวจรับ");
  assert.equal(statusLabel("unknown_state"), "unknown_state", "an unknown status shows its code rather than nothing");
  assert.equal(priorityLabel("high", true), "ด่วน");
  assert.equal(priorityLabel("urgent", true), "ด่วน");
  assert.equal(priorityLabel("urgent", false), "เร่งด่วน");
  assert.equal(priorityLabel("high", false), "สูง");
  assert.equal(isRepairType({ code: "MT_REPAIR" }), true);
  assert.equal(isRepairType({ code: "IT_REPAIR", uses_repair_workflow: false }), false, "IT repair is not the repair workflow");
  assert.equal(isRepairType({ code: "X", uses_repair_workflow: true }), true);
  assert.equal(isRepairType(null), false);
});

test("a step's waiting time starts when it reached the user, not when the request was created", () => {
  // ขั้นที่ 2: ขั้นอนุมัติทุกขั้นสร้างพร้อมใบ จึงนับจากเวลาที่ขั้นที่ 1 อนุมัติ
  assert.equal(queue.stepArrivedAt({
    fallback: "2026-11-01T02:00:00Z", status: "pending_approval",
    history: [{ to_status: "pending_approval", created_at: "2026-11-01T02:00:00Z" }],
    previousActedAt: ["2026-11-05T09:00:00Z"],
  }), "2026-11-05T09:00:00Z");
  // ส่งใหม่หลังขอข้อมูลเพิ่ม: ขั้นเดิมกลับมา นับจากวันส่งใหม่ (acted_at ของขั้นก่อนหน้าเก่ากว่า)
  assert.equal(queue.stepArrivedAt({
    fallback: "2026-11-01T02:00:00Z", status: "pending_approval",
    history: [{ to_status: "pending_approval", created_at: "2026-11-01T02:00:00Z" }, { to_status: "more_info", created_at: "2026-11-06T02:00:00Z" }, { to_status: "pending_approval", created_at: "2026-11-08T03:00:00Z" }],
    previousActedAt: ["2026-11-03T09:00:00Z"],
  }), "2026-11-08T03:00:00Z");
  // งานซ่อม: เวลาที่เข้าสถานะปัจจุบันครั้งล่าสุด (กลับมาซ่อมใหม่หลังตรวจรับไม่ผ่านนับจากรอบใหม่)
  assert.equal(queue.stepArrivedAt({
    fallback: "2026-11-01T02:00:00Z", status: "in_progress",
    history: [{ to_status: "in_progress", created_at: "2026-11-03T02:00:00Z" }, { to_status: "pending_verify", created_at: "2026-11-04T02:00:00Z" }, { to_status: "in_progress", created_at: "2026-11-05T02:00:00Z" }],
  }), "2026-11-05T02:00:00Z");
  // ไม่มีประวัติ (อ่านไม่ได้) ใช้ fallback · ค่าที่อ่านเป็นวันที่ไม่ได้ไม่นับ
  assert.equal(queue.stepArrivedAt({ fallback: "2026-11-01T02:00:00Z", status: "assigned", history: [] }), "2026-11-01T02:00:00Z");
  assert.equal(queue.stepArrivedAt({ fallback: "2026-11-01T02:00:00Z", previousActedAt: ["not a date", null] }), "2026-11-01T02:00:00Z");
  assert.equal(queue.stepArrivedAt({}), null);
});
