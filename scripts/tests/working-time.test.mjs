import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

// เวลาทำงานของบริษัท (modules/working-time.js): 08–12 + 13–17 เวลากรุงเทพ จันทร์–เสาร์ ไม่นับวันอาทิตย์และวันหยุดบริษัท
const require = createRequire(import.meta.url);
const wt = require("../../modules/working-time.js");

// เวลากรุงเทพ (+07:00) อ่านง่ายกว่า UTC · 2026-11-23 = วันจันทร์, 2026-11-28 = เสาร์, 2026-11-29 = อาทิตย์
const bkk = (local) => `${local}+07:00`;
const hours = (from, to, holidays) => wt.workingHours(bkk(from), bkk(to), holidays);

test("same-day span counts only the clock time inside working hours", () => {
  assert.equal(hours("2026-11-23T09:00:00", "2026-11-23T11:30:00"), 2.5);
  assert.equal(hours("2026-11-23T08:00:00", "2026-11-23T17:00:00"), 8);
});

test("lunch 12:00–13:00 is not counted", () => {
  assert.equal(hours("2026-11-23T11:00:00", "2026-11-23T14:00:00"), 2);
  assert.equal(hours("2026-11-23T12:10:00", "2026-11-23T12:50:00"), 0);
});

test("overnight counts the end of one day and the start of the next", () => {
  assert.equal(hours("2026-11-23T16:00:00", "2026-11-24T09:00:00"), 2);
});

test("Sunday is skipped, Saturday is a working day", () => {
  assert.equal(hours("2026-11-28T16:00:00", "2026-11-30T09:00:00"), 2); // Sat 16–17 + Mon 08–09
  assert.equal(hours("2026-11-29T08:00:00", "2026-11-29T17:00:00"), 0);
  assert.equal(hours("2026-11-28T08:00:00", "2026-11-28T17:00:00"), 8);
});

test("company holidays are skipped (Set, array of dates, or holiday rows)", () => {
  const span = ["2026-11-23T16:00:00", "2026-11-25T09:00:00"]; // Mon 16:00 → Wed 09:00
  assert.equal(hours(...span), 10);
  assert.equal(hours(...span, new Set(["2026-11-24"])), 2);
  assert.equal(hours(...span, ["2026-11-24"]), 2);
  assert.equal(hours(...span, [{ holiday_date: "2026-11-24", name_th: "หยุด" }]), 2);
});

test("start or end outside working hours is clamped to the working window", () => {
  assert.equal(hours("2026-11-23T06:00:00", "2026-11-23T10:00:00"), 2);
  assert.equal(hours("2026-11-23T15:00:00", "2026-11-23T22:00:00"), 2);
  assert.equal(hours("2026-11-23T18:00:00", "2026-11-24T07:59:00"), 0);
});

test("end before start, equal times or missing values give 0", () => {
  assert.equal(hours("2026-11-24T10:00:00", "2026-11-23T10:00:00"), 0);
  assert.equal(hours("2026-11-23T10:00:00", "2026-11-23T10:00:00"), 0);
  assert.equal(wt.workingMs(null, bkk("2026-11-23T10:00:00")), 0);
  assert.equal(wt.workingMs("garbage", bkk("2026-11-23T10:00:00")), 0);
});

test("accepts ms and Date as well as ISO text", () => {
  const start = Date.parse(bkk("2026-11-23T08:00:00"));
  assert.equal(wt.workingMs(start, new Date(start + 2 * wt.HOUR_MS)), 2 * wt.HOUR_MS);
});

test("splitWorkingHours: one day = 8 working hours, partial hours are floored", () => {
  assert.deepEqual(wt.splitWorkingHours(19.9 * wt.HOUR_MS), { totalHours: 19, days: 2, hours: 3 });
  assert.deepEqual(wt.splitWorkingHours(0), { totalHours: 0, days: 0, hours: 0 });
  assert.deepEqual(wt.splitWorkingHours(-5), { totalHours: 0, days: 0, hours: 0 });
});

test("holiday loader reads company_holidays once and retries after a failure", async () => {
  let calls = 0;
  let fail = true;
  const client = { from: (table) => ({ select: (columns) => {
    calls += 1;
    assert.equal(table, "company_holidays"); assert.equal(columns, "holiday_date");
    return Promise.resolve(fail ? { data: null, error: new Error("offline") } : { data: [{ holiday_date: "2026-12-05" }], error: null });
  } }) };
  const loader = wt.createHolidayLoader();
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await loader.load(client)).size, 0);
  } finally {
    console.warn = warn;
  }
  fail = false;
  assert.deepEqual([...await loader.load(client)], ["2026-12-05"]);
  await loader.load(client);
  assert.equal(calls, 2);
  assert.ok(loader.holidays().has("2026-12-05"));
});

test("the notify-email Edge Function keeps the same working window", () => {
  const source = readFileSync(new URL("../../supabase/functions/notify-email/index.ts", import.meta.url), "utf8");
  assert.match(source, /WORK_BLOCKS = \[\[8, 12\], \[13, 17\]\]/);
  assert.match(source, /BANGKOK_OFFSET_MS = 7 \* HOUR_MS/);
  assert.match(source, /from\("company_holidays"\)/);
});
