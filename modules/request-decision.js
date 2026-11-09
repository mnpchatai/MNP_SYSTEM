// กติกาของแถบตัดสินใจในหน้ารายละเอียดคำร้อง (app.js bindDecisionPanel) แยกออกมาให้ทดสอบได้
// - ความเห็นที่ส่งไปกับมติ = ค่าในช่องที่ผู้ใช้มองเห็นอยู่ตอนกดยืนยันเท่านั้น (ช่องที่ซ่อนอยู่ไม่ถูกส่ง)
// - มติถูกหน่วงไว้ให้กด "เลิกทำ" ได้ แล้วส่งครั้งเดียว ไม่ว่าจะครบเวลา กด "ส่งเลย" หรือออกจากหน้า
(function (root) {
  "use strict";

  // ตรงกับ COMMENT_REQUIRED ของ app_approval_decision: บังคับเหตุผลทุกมติ ยกเว้นอนุมัติ/รับทราบข้อมูล
  const COMMENT_OPTIONAL = Object.freeze(["approved", "acknowledged"]);
  const MIN_COMMENT_LENGTH = 3;

  function needsComment(decision) {
    return !COMMENT_OPTIONAL.includes(decision);
  }

  // มติที่ส่งต่อไปขั้นถัดไปเมื่อยังมีขั้นเหลือ (รับทราบข้อมูลของใบถึงฝ่ายบริหารส่งต่อเหมือนอนุมัติ)
  function forwardsToNextStep(decision) {
    return decision === "approved" || decision === "acknowledged";
  }

  function payloadFor({ decision, commentVisible, commentValue }) {
    const comment = commentVisible ? String(commentValue ?? "").trim() : "";
    if (needsComment(decision) && comment.length < MIN_COMMENT_LENGTH) {
      return {
        error: decision === "rejected"
          ? "กรุณาระบุเหตุผลที่ไม่อนุมัติ อย่างน้อย 3 ตัวอักษร"
          : decision === "more_info"
            ? "กรุณาระบุว่าต้องการข้อมูลเพิ่มเติมเรื่องอะไร อย่างน้อย 3 ตัวอักษร"
            : "กรุณาระบุเหตุผล อย่างน้อย 3 ตัวอักษร",
      };
    }
    return { comment };
  }

  // นับถอยหลังก่อนส่ง: onSend ถูกเรียกครั้งเดียวต่อการ start หนึ่งครั้ง (undo แล้วไม่ถูกเรียก)
  function createCountdown({ seconds, onSend, onTick, timers = root }) {
    let pending = null;
    let timeoutId = null;
    let intervalId = null;
    const clear = () => {
      timers.clearTimeout(timeoutId);
      timers.clearInterval(intervalId);
      timeoutId = null;
      intervalId = null;
    };
    const controller = {
      get pending() { return pending; },
      start(payload) {
        clear();
        pending = { ...payload, secondsLeft: seconds };
        intervalId = timers.setInterval(() => {
          if (!pending) return;
          pending.secondsLeft = Math.max(0, pending.secondsLeft - 1);
          onTick?.(pending.secondsLeft);
        }, 1000);
        timeoutId = timers.setTimeout(() => controller.flush(), seconds * 1000);
      },
      undo() {
        const cancelled = pending;
        clear();
        pending = null;
        return cancelled;
      },
      flush() {
        if (!pending) return null;
        const sent = pending;
        clear();
        pending = null;
        onSend(sent);
        return sent;
      },
    };
    return controller;
  }

  // ราวกันพลาดบนจอสัมผัส: ปุ่มยืนยัน (และ "ส่งเลย") โผล่ขึ้นตรงตำแหน่งที่นิ้วเพิ่งกดปุ่มมติ การแตะซ้ำสองครั้งจึงยืนยันโดยไม่ตั้งใจได้
  // หลัง arm() ไม่รับการแตะ/คลิกด้วยเมาส์ภายใน delayMs — การกดด้วยคีย์บอร์ด (Enter/Space ให้ click ที่ detail = 0) ไม่ถูกหน่วง
  function createTapGuard({ delayMs = 400, now = () => Date.now() } = {}) {
    let armedAt = null;
    return {
      arm() { armedAt = now(); },
      blocks(event) {
        if (armedAt === null || !event || event.detail === 0) return false;
        return now() - armedAt < delayMs;
      },
    };
  }

  root.MNP_REQUEST_DECISION = Object.freeze({ COMMENT_OPTIONAL, MIN_COMMENT_LENGTH, needsComment, forwardsToNextStep, payloadFor, createCountdown, createTapGuard });
})(typeof window !== "undefined" ? window : globalThis);
