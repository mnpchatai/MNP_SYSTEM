// กติกาของแถบตัดสินใจในหน้ารายละเอียดคำร้อง (modules/request-decision.js)
import { test } from "node:test";
import assert from "node:assert/strict";

await import("../../modules/request-decision.js");
const rules = globalThis.MNP_REQUEST_DECISION;

// ตัวจับเวลาปลอม: เดินเวลาเองได้ ไม่ต้องรอจริง
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  const add = (fn, ms, repeat) => { const id = nextId++; tasks.set(id, { fn, at: now + ms, ms, repeat }); return id; };
  return {
    setTimeout: (fn, ms) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: (id) => tasks.delete(id),
    clearInterval: (id) => tasks.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, task] = due;
        now = task.at;
        if (task.repeat) task.at += task.ms; else tasks.delete(id);
        task.fn();
      }
      now = end;
    },
    get pendingCount() { return tasks.size; },
  };
}

test("approve and acknowledge do not need a comment, every other decision does", () => {
  assert.equal(rules.needsComment("approved"), false);
  assert.equal(rules.needsComment("acknowledged"), false);
  for (const decision of ["rejected", "more_info", "returned"]) assert.equal(rules.needsComment(decision), true);
});

test("a hidden comment field is never sent with the decision", () => {
  // พิมพ์เหตุผลไว้ตอนเลือก "ไม่อนุมัติ" แล้วเปลี่ยนไปกด "อนุมัติ" ซึ่งช่องความเห็นถูกซ่อน
  assert.deepEqual(rules.payloadFor({ decision: "approved", commentVisible: false, commentValue: "สเปกไม่ตรง" }), { comment: "" });
  assert.deepEqual(rules.payloadFor({ decision: "approved", commentVisible: true, commentValue: "  ตรวจแล้ว  " }), { comment: "ตรวจแล้ว" });
});

test("reject and more-info need at least 3 characters of visible text", () => {
  assert.match(rules.payloadFor({ decision: "rejected", commentVisible: true, commentValue: "no" }).error ?? "", /ไม่อนุมัติ/);
  assert.match(rules.payloadFor({ decision: "more_info", commentVisible: true, commentValue: " ab " }).error ?? "", /ข้อมูลเพิ่มเติม/);
  assert.ok(rules.payloadFor({ decision: "rejected", commentVisible: false, commentValue: "เหตุผลยาวพอ" }).error, "hidden text does not count");
  assert.deepEqual(rules.payloadFor({ decision: "rejected", commentVisible: true, commentValue: "เกินงบ" }), { comment: "เกินงบ" });
});

test("acknowledge forwards to the next step like approve", () => {
  assert.equal(rules.forwardsToNextStep("approved"), true);
  assert.equal(rules.forwardsToNextStep("acknowledged"), true);
  assert.equal(rules.forwardsToNextStep("rejected"), false);
  assert.equal(rules.forwardsToNextStep("more_info"), false);
});

test("the countdown sends exactly once when time runs out", () => {
  const timers = fakeTimers();
  const sent = [];
  const ticks = [];
  const countdown = rules.createCountdown({ seconds: 5, timers, onSend: (payload) => sent.push(payload), onTick: (left) => ticks.push(left) });
  countdown.start({ decision: "approved", comment: "" });
  timers.advance(4999);
  assert.equal(sent.length, 0);
  timers.advance(1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].decision, "approved");
  assert.deepEqual(ticks, [4, 3, 2, 1, 0]);
  timers.advance(10_000);
  assert.equal(sent.length, 1, "no second send after the timer fired");
  assert.equal(timers.pendingCount, 0, "all timers are cleared");
});

test("send-now, leaving the page and the timer together still send once", () => {
  const timers = fakeTimers();
  let sends = 0;
  const countdown = rules.createCountdown({ seconds: 5, timers, onSend: () => { sends += 1; } });
  countdown.start({ decision: "rejected", comment: "เกินงบ" });
  countdown.flush(); // ส่งเลย
  countdown.flush(); // hashchange
  countdown.flush(); // visibilitychange
  timers.advance(6000);
  assert.equal(sends, 1);
  assert.equal(countdown.pending, null);
});

test("undo cancels the send and clears the timers", () => {
  const timers = fakeTimers();
  let sends = 0;
  const countdown = rules.createCountdown({ seconds: 5, timers, onSend: () => { sends += 1; } });
  countdown.start({ decision: "approved", comment: "" });
  timers.advance(2000);
  const cancelled = countdown.undo();
  assert.equal(cancelled.decision, "approved");
  timers.advance(10_000);
  assert.equal(sends, 0);
  assert.equal(countdown.flush(), null, "nothing left to flush after undo");
  assert.equal(timers.pendingCount, 0);
});

test("starting again replaces the previous countdown instead of sending both", () => {
  const timers = fakeTimers();
  const sent = [];
  const countdown = rules.createCountdown({ seconds: 5, timers, onSend: (payload) => sent.push(payload.decision) });
  countdown.start({ decision: "approved", comment: "" });
  timers.advance(1000);
  countdown.start({ decision: "rejected", comment: "เกินงบ" });
  timers.advance(10_000);
  assert.deepEqual(sent, ["rejected"]);
});
