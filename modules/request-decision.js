// กติกาของแถบตัดสินใจในหน้ารายละเอียดคำร้อง (app.js bindDecisionPanel) แยกออกมาให้ทดสอบได้
// - ความเห็นที่ส่งไปกับมติ = ค่าในช่องที่ผู้ใช้มองเห็นอยู่ตอนกดยืนยันเท่านั้น (ช่องที่ซ่อนอยู่ไม่ถูกส่ง)
// - ยืนยันแล้วส่งทันที ไม่มีช่วงเลิกทำ (ผู้ใช้กำหนด 2026-11-13) ปุ่มยืนยันกันการแตะซ้ำด้วย createTapGuard
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

  // ราวกันพลาดบนจอสัมผัส: ปุ่มยืนยันโผล่ขึ้นตรงตำแหน่งที่นิ้วเพิ่งกดปุ่มมติ การแตะซ้ำสองครั้งจึงยืนยันโดยไม่ตั้งใจได้
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

  root.MNP_REQUEST_DECISION = Object.freeze({ COMMENT_OPTIONAL, MIN_COMMENT_LENGTH, needsComment, forwardsToNextStep, payloadFor, createTapGuard });
})(typeof window !== "undefined" ? window : globalThis);
