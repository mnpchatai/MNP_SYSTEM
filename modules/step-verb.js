// คำกริยาของขั้นอนุมัติบนหน้าจอ (แถบตัดสินใจ ข้อความยืนยัน ใบเสร็จ ป้ายสถานะ) — แสดงเท่านั้น
// ค่าที่เก็บและส่งให้ฐานข้อมูลยังเป็น "approved" เสมอ (app_approval_decision ไม่เปลี่ยน)
// ได้คำจากชื่อขั้นที่มีอยู่แล้ว (เช่น "ผู้จัดการแผนกซ่อมบำรุงรับงาน") ให้ตรงกับที่แจ้งเตือนเขียนว่า "รอคุณรับงาน/รับทราบ"
// ชื่อขั้นที่ไม่มีคำเหล่านี้ (เช่น "ผู้จัดการโรงงาน") คือขั้นอนุมัติตามปกติ
(function (root) {
  "use strict";

  const DEFAULT_VERB = "อนุมัติ";
  // เรียงตามลำดับที่ตรวจ: คำที่เจาะจงกว่าก่อน
  const STEP_VERBS = Object.freeze(["รับงาน", "รับทราบ"]);

  // takenLabels: ป้ายของมติเพิ่มเติมของโมดูลที่แสดงอยู่ในแถบเดียวกัน (เช่น "รับทราบข้อมูล" ของใบถึงฝ่ายบริหาร)
  // ถ้าคำของขั้นซ้ำกับป้ายเหล่านั้น ใช้ "อนุมัติ" เพื่อไม่ให้มีสองปุ่มที่อ่านเหมือนกัน
  function verbOf(stepName, takenLabels = []) {
    const name = String(stepName ?? "");
    const verb = STEP_VERBS.find((candidate) => name.includes(candidate)) ?? DEFAULT_VERB;
    return takenLabels.some((label) => String(label ?? "").includes(verb)) ? DEFAULT_VERB : verb;
  }

  // ป้ายสถานะของใบที่รอขั้นนี้ ("รอรับงาน") — สถานะอื่นไม่เปลี่ยน
  function pendingLabel(stepName) {
    return `รอ${verbOf(stepName)}`;
  }

  // ขั้นที่ทำต่อหลังอนุมัติขั้นสุดท้าย: ใบแจ้งซ่อมไปมอบหมายช่าง, ใบทั่วไปไปดำเนินงาน, ใบที่จบที่มติไม่มี
  function afterLastStep({ repair = false, endsAtDecision = false } = {}) {
    if (endsAtDecision) return null;
    return repair ? "มอบหมายช่าง" : "ดำเนินงาน";
  }

  // บรรทัดใต้หัวแถบตัดสินใจ: ขั้นนี้ + ขั้นถัดไปจริง
  // nextStepKnown = false (โหลดลำดับขั้นไม่ได้): ไม่บอกอะไรเกี่ยวกับขั้นถัดไป ไม่เดาว่าเป็นขั้นสุดท้าย
  function stepLineText({ currentStepName, nextStepName = null, nextStepKnown = true, afterLast = null }) {
    const current = `ขั้นตอน: ${currentStepName}`;
    if (nextStepName) return `${current} · ถัดไป: ${nextStepName}`;
    if (!nextStepKnown) return current;
    return afterLast ? `${current} · ถัดไป: ${afterLast}` : `${current} · ขั้นสุดท้าย`;
  }

  root.MNP_STEP_VERB = Object.freeze({ DEFAULT_VERB, STEP_VERBS, verbOf, pendingLabel, afterLastStep, stepLineText });
})(typeof window !== "undefined" ? window : globalThis);
