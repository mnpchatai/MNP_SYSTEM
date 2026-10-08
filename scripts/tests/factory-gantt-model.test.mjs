import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const model = createRequire(import.meta.url)("../../modules/factory-gantt-model.js");

// ศูนย์งานตัวอย่าง: RB 08:00–17:00 พัก 60 = 480 นาที/วัน จันทร์–ศุกร์ · GR 2 เครื่อง ประสิทธิภาพ 50% = 480 นาที/วัน · PT เสาร์–อาทิตย์เท่านั้น
const center = (code, extra = {}) => ({ code, name: `ศูนย์ ${code}`, shift_start: "08:00", shift_end: "17:00", break_minutes: 60, working_days: [1, 2, 3, 4, 5], units: 1, efficiency_percent: 100, calendar_version: 1, ...extra });
const CENTERS = [center("RB"), center("GR", { units: 2, efficiency_percent: 50 }), center("PT", { working_days: [6, 7] })];
const step = (sequence, centerCode, setup, run, status = "pending") => ({ sequence, name: `ขั้น ${sequence}`, work_center_code: centerCode, setup_minutes: setup, run_minutes: run, status });
const job = (id, extra = {}) => ({ id, code: id.toUpperCase(), status: "open", production_order_id: "o1", item_id: `i-${id}`, item_code: `ITEM-${id}`, item_name: id, unit_code: "KG", qty: 100, bom_output_qty: 100,
  planned_start: null, planned_end: null, schedule_version: 1, needs: [], steps: [step(10, "RB", 10, 100)], ...extra });
// 2026-10-12 เป็นวันจันทร์
const MON = "2026-10-12";

test("dates are calendar days computed in UTC: parsing, validity, differences, ISO weekdays and Thai today", () => {
  assert.equal(model.isDate("2026-02-28"), true);
  for (const bad of ["2026-02-30", "2026-13-01", "26-1-1", "", null, undefined, "2026-10-12T00:00:00Z", 20261012]) assert.equal(model.isDate(bad), false, String(bad));
  assert.equal(model.addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(model.addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(model.diffDays("2026-10-12", "2026-10-19"), 7);
  assert.equal(model.diffDays("2026-10-19", "2026-10-12"), -7);
  assert.equal(model.weekday(MON), 1, "Monday is 1");
  assert.equal(model.weekday("2026-10-17"), 6);
  assert.equal(model.weekday("2026-10-18"), 7, "Sunday is 7");
  assert.equal(model.today(Date.UTC(2026, 9, 11, 17, 30)), "2026-10-12", "17:30 UTC is already Monday in Thailand (UTC+7)");
  assert.equal(model.today(Date.UTC(2026, 9, 11, 16, 59)), "2026-10-11");
});

test("capacity per day = (shift - break) x machines x efficiency, and unreadable data has no capacity", () => {
  assert.equal(model.capacityMinutes(CENTERS[0]), 480);
  assert.equal(model.capacityMinutes(CENTERS[1]), 480, "2 machines at 50%");
  assert.equal(model.capacityMinutes(center("X", { units: 3, efficiency_percent: 85.5 })), 1231.2);
  assert.equal(model.capacityMinutes(center("X", { shift_start: "08:00:00", shift_end: "12:30:00", break_minutes: 30 })), 240, "database time strings with seconds are accepted");
  assert.equal(model.capacityMinutes(center("X", { shift_end: "07:00" })), 0, "a shift that ends before it starts has no capacity");
  assert.equal(model.capacityMinutes(center("X", { break_minutes: 540 })), 0, "a break as long as the shift leaves nothing");
  assert.equal(model.capacityMinutes(center("X", { shift_start: "25:00" })), 0);
  assert.equal(model.capacityMinutes(null), 0);
});

test("working days are ISO weekdays with a labelled summary, and an empty or bad list falls back to Monday to Friday", () => {
  assert.equal(model.isWorkingDay(CENTERS[0], MON), true);
  assert.equal(model.isWorkingDay(CENTERS[0], "2026-10-17"), false, "Saturday");
  assert.equal(model.isWorkingDay(CENTERS[2], "2026-10-17"), true);
  assert.deepEqual(model.workingDaysOf({ working_days: [] }), [1, 2, 3, 4, 5]);
  assert.deepEqual(model.workingDaysOf({ working_days: [0, 9, "x", 3] }), [3], "values outside 1 to 7 are dropped");
  assert.equal(model.workingDaysLabel(CENTERS[0]), "จันทร์–ศุกร์");
  assert.equal(model.workingDaysLabel(center("X", { working_days: [1, 2, 3, 4, 5, 6, 7] })), "ทุกวัน");
  assert.equal(model.workingDaysLabel(center("X", { working_days: [1, 3, 6] })), "จ พ ส", "days that are not consecutive are listed");
  assert.equal(model.workingDaysLabel(center("X", { working_days: [6, 7] })), "ส อา", "two consecutive days are listed, not a range");
});

test("job load = setup + run time per batch x batches, only for the steps still to do", () => {
  const one = job("a", { qty: 100, bom_output_qty: 100, steps: [step(10, "RB", 10, 30), step(20, "GR", 5, 20)] });
  assert.equal(model.batches(one), 1);
  assert.deepEqual(model.remainingLoad(one), { RB: 40, GR: 25 });
  const three = job("b", { qty: 250, bom_output_qty: 100, steps: [step(10, "RB", 10, 30)] });
  assert.equal(model.batches(three), 3, "250 / 100 rounds up to 3 batches");
  assert.deepEqual(model.remainingLoad(three), { RB: 100 }, "10 + 30 x 3");
  assert.equal(model.batches(job("c", { qty: 100.01, bom_output_qty: 100 })), 2, "a real excess still needs another batch");
  assert.equal(model.batches(job("c", { qty: 300.0000001, bom_output_qty: 100 })), 3, "floating point dust does not add a batch");
  assert.equal(model.batches(job("c", { qty: 0.5, bom_output_qty: 100 })), 1, "less than one batch is one batch");
  assert.equal(model.batches(job("c", { bom_output_qty: 0 })), 1, "a missing batch size counts as one batch");
  const partly = job("d", { steps: [step(10, "RB", 10, 30, "done"), step(20, "RB", 5, 20), step(30, "GR", 0, 60)] });
  assert.deepEqual(model.remainingLoad(partly), { RB: 25, GR: 60 }, "the finished step is not counted");
  assert.deepEqual(model.remainingLoad(job("e", { steps: [step(10, "rb", 1, 1)] })), { RB: 2 }, "work center codes are upper-cased");
  assert.deepEqual(model.remainingLoad(null), {});
});

test("daily load spreads each job evenly over the working days of the center inside its window", () => {
  // จันทร์ 12 – ศุกร์ 16 = 5 วันทำงานของ RB · ภาระ 10 + 100 x 1 = 110 → 22 นาทีต่อวัน
  const week = job("a", { planned_start: MON, planned_end: "2026-10-16" });
  const { load, unplaced } = model.dailyLoad([week], CENTERS);
  assert.deepEqual(Object.keys(load.RB), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  assert.ok(Object.values(load.RB).every((minutes) => Math.abs(minutes - 22) < 1e-9));
  assert.deepEqual(unplaced, []);
  // ช่วงจันทร์ – อาทิตย์ ข้ามเสาร์-อาทิตย์ที่ RB หยุด ภาระยังลงเฉพาะ 5 วันทำงาน
  const wholeWeek = model.dailyLoad([job("b", { planned_start: MON, planned_end: "2026-10-18" })], CENTERS).load.RB;
  assert.equal(Object.keys(wholeWeek).length, 5);
  assert.ok(!("2026-10-17" in wholeWeek) && !("2026-10-18" in wholeWeek));
  // ใบงานหลายใบรวมกันในวันเดียวกัน
  const stacked = model.dailyLoad([job("a", { planned_start: MON, planned_end: MON }), job("b", { planned_start: MON, planned_end: MON })], CENTERS).load.RB;
  assert.equal(stacked[MON], 220, "110 + 110 on the same day");
});

test("daily load ignores jobs that are finished, unscheduled or at an unknown center, and reports a window with no working day", () => {
  const ignored = [
    job("done", { status: "completed", planned_start: MON, planned_end: MON }), job("none"),
    job("ghost", { planned_start: MON, planned_end: MON, steps: [step(10, "ZZ", 0, 100)] }),
    job("zero", { planned_start: MON, planned_end: MON, steps: [step(10, "RB", 0, 0)] }),
  ];
  assert.deepEqual(model.dailyLoad(ignored, CENTERS), { load: {}, unplaced: [] });
  const saturday = job("sat", { planned_start: "2026-10-17", planned_end: "2026-10-17" });
  const result = model.dailyLoad([saturday], CENTERS);
  assert.deepEqual(result.load, {}, "RB does not work on Saturday");
  assert.equal(result.unplaced.length, 1);
  assert.equal(result.unplaced[0].code, "RB");
  assert.equal(result.unplaced[0].minutes, 110);
  assert.equal(result.unplaced[0].job.id, "sat");
  assert.deepEqual(model.dailyLoad(null, null), { load: {}, unplaced: [] });
});

test("a day is overloaded only when the load is above the capacity of that center", () => {
  const exact = model.dailyLoad([job("a", { planned_start: MON, planned_end: MON, steps: [step(10, "RB", 0, 480)] })], CENTERS);
  assert.deepEqual(model.overloads(exact.load, CENTERS), [], "exactly the capacity is not overloaded");
  const over = model.dailyLoad([job("a", { planned_start: MON, planned_end: MON, steps: [step(10, "RB", 0, 600), step(20, "GR", 0, 100)] })], CENTERS);
  assert.deepEqual(model.overloads(over.load, CENTERS), [{ code: "RB", date: MON, load: 600, capacity: 480, percent: 125 }]);
  assert.equal(model.utilizationLevel(100, 480), "ok");
  assert.equal(model.utilizationLevel(384, 480), "ok", "80% is still fine");
  assert.equal(model.utilizationLevel(385, 480), "warn");
  assert.equal(model.utilizationLevel(480, 480), "warn", "full but not above");
  assert.equal(model.utilizationLevel(481, 480), "over");
  assert.equal(model.utilizationLevel(1, 0), "over", "no capacity at all is overloaded");
});

test("orders are the frames: sorted by due date, jobs by start with unscheduled last, range covers the scheduled jobs", () => {
  const data = {
    orders: [{ id: "o2", code: "MO-2", due_date: "2026-11-30", customer: "ข" }, { id: "o1", code: "MO-1", due_date: "2026-10-30", customer: "ก" }, { id: "o3", code: "MO-3", due_date: "2026-10-01" }],
    jobs: [
      job("late", { production_order_id: "o1", planned_start: "2026-10-20", planned_end: "2026-11-02" }), job("none", { production_order_id: "o1" }),
      job("early", { production_order_id: "o1", planned_start: "2026-10-13", planned_end: "2026-10-15" }), job("other", { production_order_id: "o2", planned_start: "2026-10-14", planned_end: "2026-10-16" }),
    ],
  };
  const groups = model.groupByOrder(data);
  assert.deepEqual(groups.map((group) => group.order.code), ["MO-1", "MO-2"], "MO-3 has no jobs and is not drawn; MO-1 is due first");
  assert.deepEqual(groups[0].jobs.map((row) => row.id), ["early", "late", "none"]);
  assert.equal(groups[0].start, "2026-10-13");
  assert.equal(groups[0].end, "2026-11-02");
  assert.equal(groups[0].scheduledCount, 2);
  assert.equal(groups[0].unscheduledCount, 1);
  assert.equal(groups[0].late, true, "ends after the due date 2026-10-30");
  assert.equal(groups[1].late, false);
  assert.deepEqual(model.groupByOrder({ orders: [], jobs: [] }), []);
  assert.deepEqual(model.groupByOrder(null), []);
  const unscheduledOnly = model.groupByOrder({ orders: [{ id: "o1", code: "MO-1", due_date: "2026-10-30" }], jobs: [job("a")] });
  assert.equal(unscheduledOnly[0].start, null);
  assert.equal(unscheduledOnly[0].late, false);
});

test("late jobs are the unfinished scheduled ones that end after the due date of their order", () => {
  const data = {
    orders: [{ id: "o1", code: "MO-1", due_date: "2026-10-20" }, { id: "o2", code: "MO-2", due_date: null }],
    jobs: [
      job("on-time", { planned_start: MON, planned_end: "2026-10-20" }), job("late", { planned_start: MON, planned_end: "2026-10-21" }),
      job("done-late", { status: "completed", planned_start: MON, planned_end: "2026-10-25" }), job("no-due", { production_order_id: "o2", planned_start: MON, planned_end: "2026-12-01" }), job("unscheduled"),
    ],
  };
  assert.deepEqual(model.lateJobs(data).map((row) => row.id), ["late"]);
});

test("a job that starts before the job making a piece it needs has ended is a conflict, starting on the same day is not", () => {
  const rubber = job("rubber", { planned_start: MON, planned_end: "2026-10-14" });
  const data = { jobs: [
    rubber,
    job("early", { needs: ["rubber"], planned_start: "2026-10-13", planned_end: "2026-10-16" }),
    job("same-day", { needs: ["rubber"], planned_start: "2026-10-14", planned_end: "2026-10-16" }),
    job("after", { needs: ["rubber"], planned_start: "2026-10-15", planned_end: "2026-10-16" }),
    job("not-scheduled", { needs: ["rubber"] }),
    job("finished", { status: "completed", needs: ["rubber"], planned_start: MON, planned_end: MON }),
    job("unknown-need", { needs: ["missing"], planned_start: MON, planned_end: MON }),
  ] };
  const rows = model.conflicts(data);
  assert.deepEqual(rows.map((row) => [row.job.id, row.needs.id]), [["early", "rubber"]]);
  assert.deepEqual(model.conflicts({ jobs: [job("a", { needs: ["b"], planned_start: MON, planned_end: MON }), job("b")] }), [], "a needed job that is not scheduled yet is not a conflict");
});

test("the chart range covers every bar, due date and today with a margin and is never shorter than two weeks", () => {
  const data = { orders: [{ id: "o1", due_date: "2026-11-10" }], jobs: [job("a", { planned_start: "2026-10-20", planned_end: "2026-11-02" }), job("b")] };
  const range = model.range(data, "2026-10-15");
  assert.equal(range.from, "2026-10-13", "today (10-15) is the earliest date, 2 days of margin");
  assert.equal(range.to, "2026-11-14", "the due date 11-10 is the latest, 4 days of margin");
  assert.equal(range.days, model.diffDays(range.from, range.to) + 1);
  const empty = model.range({}, "2026-10-15");
  assert.equal(empty.days, 14, "with no data it is two weeks around today");
  assert.equal(empty.from, "2026-10-13");
  assert.equal(model.range(null, "2026-10-15").days, 14);
  const bad = model.range({ orders: [{ due_date: "nonsense" }], jobs: [] }, "2026-10-15");
  assert.equal(bad.from, "2026-10-13", "an unreadable due date is ignored instead of breaking the chart");
});

test("the date check matches the database rules and the shift moves both ends", () => {
  assert.equal(model.validateDates(MON, MON), null, "one day is fine");
  assert.equal(model.validateDates(MON, "2026-10-20"), null);
  assert.equal(model.validateDates("", MON), "INVALID_SCHEDULE_DATES");
  assert.equal(model.validateDates(MON, ""), "INVALID_SCHEDULE_DATES");
  assert.equal(model.validateDates("2026-10-20", MON), "INVALID_SCHEDULE_DATES", "end before start");
  assert.equal(model.validateDates("2026-02-30", "2026-03-02"), "INVALID_SCHEDULE_DATES", "a date that does not exist");
  assert.equal(model.validateDates("2026-01-01", "2027-01-02"), "INVALID_SCHEDULE_DATES", "366 days after the start is too long");
  assert.equal(model.validateDates("2026-01-01", "2027-01-01"), null, "365 days after the start is the longest");
  assert.equal(model.validateDates("2019-12-31", "2020-01-02"), "INVALID_SCHEDULE_DATES");
  assert.equal(model.validateDates("2100-12-30", "2101-01-02"), "INVALID_SCHEDULE_DATES");
  assert.deepEqual(model.shiftWindow({ planned_start: "2026-10-31", planned_end: "2026-11-02" }, 1), { start: "2026-11-01", end: "2026-11-03" });
  assert.deepEqual(model.shiftWindow({ planned_start: "2026-03-01", planned_end: "2026-03-02" }, -1), { start: "2026-02-28", end: "2026-03-01" });
});

test("the working-day estimate adds up each remaining step over the capacity of its center, at least one day", () => {
  // RB 480/วัน: 10 + 470 = 480 → 1 วัน · GR 480/วัน: 240 → 0.5 วัน รวม 1.5 → ปัดเป็น 2
  const a = job("a", { steps: [step(10, "RB", 10, 470), step(20, "GR", 0, 240)] });
  assert.equal(model.estimateWorkingDays(a, CENTERS), 2);
  assert.equal(model.estimateWorkingDays(job("b", { steps: [step(10, "RB", 0, 1)] }), CENTERS), 1, "never less than one day");
  assert.equal(model.estimateWorkingDays(job("c", { steps: [step(10, "RB", 0, 960)] }), CENTERS), 2, "exactly two days of work is two days");
  assert.equal(model.estimateWorkingDays(job("d", { steps: [step(10, "RB", 0, 960, "done"), step(20, "RB", 0, 480)] }), CENTERS), 1, "finished steps are not counted");
  assert.equal(model.estimateWorkingDays(job("e", { steps: [step(10, "ZZ", 0, 9999)] }), CENTERS), 1, "an unknown center adds nothing");
  assert.equal(model.estimateWorkingDays(a, null), 1);
});

test("the suggested end counts working days of the centers the job uses, starting with the start day itself", () => {
  const days = new Set([1, 2, 3, 4, 5]);
  assert.equal(model.endForWorkingDays(MON, 1, days), MON, "one working day starting on a working day ends the same day");
  assert.equal(model.endForWorkingDays(MON, 3, days), "2026-10-14");
  assert.equal(model.endForWorkingDays("2026-10-15", 3, days), "2026-10-19", "Thu, Fri, then Mon (the weekend is skipped)");
  assert.equal(model.endForWorkingDays("2026-10-17", 1, days), "2026-10-19", "starting on a Saturday the first working day is Monday");
  assert.equal(model.endForWorkingDays(MON, 0, days), MON, "zero is treated as one");
  const both = model.jobWorkingDays(job("a", { steps: [step(10, "RB", 0, 1), step(20, "PT", 0, 1)] }), CENTERS);
  assert.deepEqual([...both].sort(), [1, 2, 3, 4, 5, 6, 7], "union of RB (Mon-Fri) and PT (Sat-Sun)");
  assert.deepEqual([...model.jobWorkingDays(job("a", { steps: [step(10, "ZZ", 0, 1)] }), CENTERS)].sort(), [1, 2, 3, 4, 5], "unknown centers fall back to Monday to Friday");
});

test("a suggested window starts today, or after the jobs this one needs have ended", () => {
  const data = {
    work_centers: CENTERS,
    jobs: [job("rubber", { planned_start: MON, planned_end: "2026-10-16" }), job("part", { needs: ["rubber"], steps: [step(10, "RB", 0, 960)] }), job("free", { steps: [step(10, "RB", 0, 480)] }), job("loose", { needs: ["rubber-unscheduled"] }), job("rubber-unscheduled")],
  };
  assert.deepEqual(model.suggestWindow(data.jobs[1], data, "2026-10-13"), { start: "2026-10-16", end: "2026-10-19" }, "starts the day the rubber job ends, 2 working days");
  assert.deepEqual(model.suggestWindow(data.jobs[2], data, "2026-10-13"), { start: "2026-10-13", end: "2026-10-13" });
  assert.equal(model.suggestWindow(data.jobs[3], data, "2026-10-13").start, "2026-10-13", "a needed job that has no dates yet does not delay the start");
  assert.equal(model.suggestWindow(data.jobs[1], data, "2026-10-20").start, "2026-10-20", "never earlier than today");
});

test("progress counts finished steps and the summary counts what needs the planner's attention", () => {
  assert.deepEqual(model.progress(job("a", { steps: [step(10, "RB", 0, 1, "done"), step(20, "RB", 0, 1), step(30, "RB", 0, 1), step(40, "RB", 0, 1)] })), { done: 1, total: 4, percent: 25 });
  assert.deepEqual(model.progress(job("a", { steps: [] })), { done: 0, total: 0, percent: 0 });
  const data = {
    work_centers: CENTERS,
    orders: [{ id: "o1", code: "MO-1", due_date: "2026-10-14" }],
    jobs: [
      job("a", { planned_start: MON, planned_end: "2026-10-15", steps: [step(10, "RB", 0, 1000)] }),
      job("b", { needs: ["a"], planned_start: "2026-10-13", planned_end: "2026-10-13" }),
      job("c"), job("d", { status: "completed", planned_start: MON, planned_end: MON }),
    ],
  };
  const summary = model.summary(data, "2026-10-12");
  assert.equal(summary.orders, 1);
  assert.equal(summary.jobsActive, 3, "the completed job is not active");
  assert.equal(summary.unscheduled, 1, "job c");
  assert.equal(summary.late, 1, "job a ends 10-15 after the due date 10-14");
  assert.equal(summary.conflicts, 1, "job b starts before job a ends");
  assert.equal(summary.overloadDays, 0, "1000 minutes over 4 working days is 250 per day, below 480");
  assert.equal(summary.today, "2026-10-12");
});
