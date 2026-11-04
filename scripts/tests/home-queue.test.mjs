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
