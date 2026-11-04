// ส่วนประกอบฟอร์มทีละขั้น: ร่างบนเครื่อง (form-draft), การตรวจช่องภาษาไทย/ขั้น (form-steps), ตัวเลือกวันที่ไทย (date-picker)
import { test } from "node:test";
import assert from "node:assert/strict";

await import("../../modules/form-draft.js");
await import("../../modules/form-steps.js");
await import("../../modules/date-picker.js");
const draft = globalThis.MNP_FORM_DRAFT;
const steps = globalThis.MNP_FORM_STEPS;
const picker = globalThis.MNP_DATE_PICKER;

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
    size: () => data.size,
  };
}

test("a draft round-trips and is scoped by type and employee", () => {
  const storage = memoryStorage();
  const key = draft.draftKey("MT_REPAIR", "e1");
  assert.equal(key, "mnp-draft:MT_REPAIR:e1");
  const store = draft.createDraftStore({ key, storage, now: () => 1_000 });
  store.save({ description: "ปั๊มรั่ว", is_urgent: true });
  assert.deepEqual(store.load(), { values: { description: "ปั๊มรั่ว", is_urgent: true }, savedAt: 1_000 });
  assert.equal(draft.createDraftStore({ key: draft.draftKey("MT_REPAIR", "e2"), storage }).load(), null, "another employee sees nothing");
});

test("an empty form clears the draft instead of saving it", () => {
  const storage = memoryStorage();
  const store = draft.createDraftStore({ key: "k", storage, ignoreForEmpty: ["requester_name"] });
  store.save({ description: "x" });
  store.save({ description: "", is_urgent: false, requester_name: "สมใจ รักงาน" });
  assert.equal(storage.size(), 0);
  assert.equal(store.load(), null);
});

test("values the form fills in by itself never make a draft", () => {
  // แผนกเริ่มต้นถูกเลือกให้ตอนเปิดฟอร์ม: ถ้านับเป็นการกรอก จะถามเรื่องร่างทุกครั้งที่เข้าฟอร์ม
  const storage = memoryStorage();
  const ignoreForEmpty = ["requester_name", "doc_type", "department_id", "machine_label"];
  const store = draft.createDraftStore({ key: "k", storage, ignoreForEmpty });
  store.save({ department_id: "dep-mt", machine_id: "", machine_label: "", doc_type: "repair", description: "", needed_date: "", requester_name: "", is_urgent: false });
  assert.equal(storage.size(), 0);
  store.save({ department_id: "dep-mt", machine_id: "m-1", machine_label: "H-HL1-1", doc_type: "repair", description: "", needed_date: "", requester_name: "", is_urgent: false });
  assert.equal(store.load()?.values.department_id, "dep-mt", "a chosen machine keeps its department");
});

test("signing out clears every form draft on the device and nothing else", () => {
  const storage = memoryStorage();
  storage.setItem(draft.draftKey("MT_REPAIR", "e1"), "{}");
  storage.setItem(draft.draftKey("IT_REPAIR", "e2"), "{}");
  storage.setItem("mnp-theme", "dark");
  draft.clearAll(storage);
  assert.equal(storage.size(), 1);
  assert.equal(storage.getItem("mnp-theme"), "dark");
  assert.doesNotThrow(() => draft.clearAll({ get length() { throw new Error("blocked"); } }));
});

test("old, corrupt or foreign drafts are dropped", () => {
  const storage = memoryStorage();
  let clock = 0;
  const store = draft.createDraftStore({ key: "k", storage, now: () => clock, maxAgeMs: 100 });
  store.save({ description: "x" });
  clock = 101;
  assert.equal(store.load(), null, "expired");
  assert.equal(storage.size(), 0, "expired draft removed");
  storage.setItem("k", "{not json");
  assert.equal(store.load(), null, "corrupt");
  storage.setItem("k", JSON.stringify({ v: 999, savedAt: 0, values: { a: "b" } }));
  assert.equal(store.load(), null, "unknown version");
});

test("a broken storage never throws", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("blocked"); } };
  const store = draft.createDraftStore({ key: "k", storage: broken });
  assert.doesNotThrow(() => store.save({ description: "x" }));
  assert.equal(store.load(), null);
  assert.doesNotThrow(() => store.clear());
  assert.equal(draft.createDraftStore({ key: "k", storage: null }).load(), null);
});

test("validation reports missing and too-short fields in screen order", () => {
  const rules = [
    { name: "department_id", step: 1, required: true, message: "กรุณาเลือกแผนก" },
    { name: "machine_id", step: 1, required: true, message: "กรุณาเลือกเครื่องจักร" },
    { name: "description", step: 1, required: true, minLength: 3, message: "กรุณาอธิบายอาการ" },
    { name: "needed_date", step: 2, minLength: 10, message: "วันที่ไม่ถูกต้อง" },
  ];
  assert.deepEqual(steps.validate(rules, { department_id: "", machine_id: "m1", description: "  ab ", needed_date: "" }).map((error) => error.name), ["department_id", "description"]);
  assert.deepEqual(steps.validate(rules, { department_id: "d1", machine_id: "m1", description: "ปั๊มรั่ว", needed_date: "" }), [], "optional empty fields pass");
  assert.equal(steps.validate(rules, { department_id: "d1", machine_id: "m1", description: "ok!", needed_date: "2026-1" })[0].step, 2);
});

test("narrow screens show one step at a time with review last; wide screens show everything but review", () => {
  assert.deepEqual(steps.stepView({ current: 1, count: 3, narrow: true }), { visible: [1], showBack: false, showNext: true, showSubmit: false, label: "ขั้นที่ 1 จาก 3" });
  assert.deepEqual(steps.stepView({ current: 3, count: 3, narrow: true }), { visible: [3], showBack: true, showNext: false, showSubmit: true, label: "ขั้นที่ 3 จาก 3" });
  assert.deepEqual(steps.stepView({ current: 9, count: 3, narrow: true }).visible, [3], "clamped");
  assert.deepEqual(steps.stepView({ current: 2, count: 3, narrow: false }), { visible: [1, 2], showBack: false, showNext: false, showSubmit: true, label: "" });
});

test("dates read in Thai with Buddhist-era years", () => {
  assert.equal(picker.label("2026-11-04"), "4 พ.ย. 2569");
  assert.equal(picker.label(""), "");
  assert.equal(picker.label("04/11/2026"), "");
  assert.equal(picker.fullLabel("2026-11-04"), "วันพุธที่ 4 พฤศจิกายน 2569");
  assert.equal(picker.monthTitle("2027-01-15"), "มกราคม 2570");
});

test("today follows Bangkok time, not the device clock's zone", () => {
  assert.equal(picker.todayIso(Date.parse("2026-11-03T17:30:00Z")), "2026-11-04", "00:30 in Bangkok");
  assert.equal(picker.todayIso(Date.parse("2026-11-03T16:59:00Z")), "2026-11-03", "23:59 in Bangkok");
});

test("day and month moves stay on real calendar days", () => {
  assert.equal(picker.shiftDays("2026-12-31", 1), "2027-01-01");
  assert.equal(picker.shiftDays("2028-03-01", -1), "2028-02-29", "leap year");
  assert.equal(picker.shiftMonths("2026-01-31", 1), "2026-02-28", "end of month clamps");
  assert.equal(picker.shiftMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(picker.shiftMonths("2026-11-15", 2), "2027-01-15");
});

test("the month grid is six Sunday-first weeks covering the whole month", () => {
  const grid = picker.monthMatrix("2026-11-20");
  assert.equal(grid.length, 6);
  assert.ok(grid.every((week) => week.length === 7));
  assert.equal(grid[0][0].iso, "2026-11-01", "1 Nov 2026 is a Sunday");
  assert.equal(picker.weekday(grid[0][0].iso), 0);
  const inMonth = grid.flat().filter((cell) => cell.inMonth).map((cell) => cell.iso);
  assert.equal(inMonth.length, 30);
  assert.equal(inMonth.at(-1), "2026-11-30");
  assert.equal(picker.monthMatrix("2027-02-10")[0][0].iso, "2027-01-31", "February 2027 starts on a Monday");
});
