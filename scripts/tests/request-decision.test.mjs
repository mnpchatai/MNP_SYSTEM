// กติกาของแถบตัดสินใจในหน้ารายละเอียดคำร้อง (modules/request-decision.js)
import { test } from "node:test";
import assert from "node:assert/strict";

await import("../../modules/request-decision.js");
const rules = globalThis.MNP_REQUEST_DECISION;

test("approve and acknowledge do not need a comment, every other decision does", () => {
  assert.equal(rules.needsComment("approved"), false);
  assert.equal(rules.needsComment("acknowledged"), false);
  for (const decision of ["rejected", "more_info"]) assert.equal(rules.needsComment(decision), true);
});

// พิสูจน์เฉพาะกติกาของ payloadFor; การล้างช่องเมื่อยกเลิก/เปลี่ยนมติอยู่ใน bindDecisionPanel (app.js) ซึ่งยังไม่มีเทสต์ระดับ DOM
test("payloadFor drops the comment when the field is reported hidden", () => {
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

test("there is no undo countdown any more: confirming sends at once (user 2026-11-13)", () => {
  assert.equal(rules.createCountdown, undefined);
});

test("the confirm button ignores a tap that lands right after it appears, but not keyboard activation", () => {
  let now = 1000;
  const guard = rules.createTapGuard({ delayMs: 400, now: () => now });
  assert.equal(guard.blocks({ detail: 1 }), false, "never armed: nothing is blocked");
  guard.arm();
  now += 399;
  assert.equal(guard.blocks({ detail: 1 }), true, "a second tap within 400 ms is ignored");
  assert.equal(guard.blocks({ detail: 2 }), true, "so is the second click of a double tap");
  assert.equal(guard.blocks({ detail: 0 }), false, "Enter/Space (click with detail 0) is never delayed");
  now += 1;
  assert.equal(guard.blocks({ detail: 1 }), false, "after 400 ms a deliberate tap goes through");
  guard.arm();
  assert.equal(guard.blocks({ detail: 1 }), true, "arming again (back to compose after undo) restarts the window");
});
