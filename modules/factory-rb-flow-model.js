// RubberFlow — ตรรกะหน้าแผนก RB (ขึ้นรูปยาง) แบบ 4 สถานีตามสายผลิตยางของต้นแบบ prototypes/rubber-mes
// (ผสมยาง → ขึ้นรูป → อบ → ตัดและตกแต่ง) บนใบงานผลิตจริงของโมดูลฝ่ายโรงงาน — ไม่มี DOM/Supabase เทสต์ด้วย node --test
// (scripts/tests/factory-rb-flow-model.test.mjs)
//
// ต้นแบบเก็บ "ล็อต" ของแต่ละสถานีแยกกัน แต่ระบบจริงมีใบงานผลิตใบเดียวเดินตาม Routing (ขั้นของแผนก RB เรียงกัน แล้วส่งต่อ SR/QC)
// ที่นี่จึง "จัดขั้นของ Routing เข้าสถานี" จากชื่อขั้น (คำสำคัญใน STAGE_RULES) แล้วใบงานอยู่ที่สถานีของขั้นถัดไปที่ยังรอทำ
// กฎจริง (ลำดับขั้น แผนก ค่าพารามิเตอร์ กักกัน ตัดวัตถุดิบ รับผลผลิต) ยังอยู่ที่ RPC ของฐานข้อมูลผ่าน modules/factory-job-model.js
// เหมือนหน้าใบงานทั่วไป — ไฟล์นี้ใช้จัดกลุ่ม นับ และบอกเวลาพักยางเพื่อความสะดวกเท่านั้น ไม่ใช่การควบคุมสิทธิ์
(function (root) {
  const DEPARTMENT = "RB";

  // สถานีเรียงตามสายผลิต (ป้ายตามต้นแบบ RubberFlow ปรับให้ตรงขั้นของ RB: ขั้นฉีด/รีด = ขึ้นรูป, ขั้นตัด = ตัดและตกแต่ง)
  const STAGES = Object.freeze([
    Object.freeze({ key: "mixing", label: "ผสมยาง", hint: "ชั่งเคมี ตียาง ใส่เคมี พักยาง" }),
    Object.freeze({ key: "forming", label: "ขึ้นรูป", hint: "ฉีด รีด ขึ้นรูป" }),
    Object.freeze({ key: "curing", label: "อบ", hint: "อบ Oven / HCM วัลคาไนซ์" }),
    Object.freeze({ key: "finishing", label: "ตัดและตกแต่ง", hint: "ตัด ตกแต่ง ตรวจ บรรจุ" }),
  ]);
  const STAGE_KEYS = Object.freeze(STAGES.map((stage) => stage.key));
  const stageInfo = (key) => STAGES.find((stage) => stage.key === key) ?? null;

  // คำสำคัญในชื่อขั้น → สถานี ตรวจตามลำดับนี้ (คำที่เจาะจงกว่าอยู่ก่อน) คำไทยใช้คำประสมที่พบในชื่อขั้นของ Routing RB
  // "อบ" นับเฉพาะที่ขึ้นต้นคำ (ต้นข้อความ หรือหลังอักขระที่ไม่ใช่ไทย เช่น ช่องว่าง/เลข/รหัสขั้น) จึงไม่ชนกับ "รอบ/ประกอบ/ตอบ"
  // แต่ "นำไปอบ" ที่เขียนติดกันจะไม่ตรง (ไม่ใช้ lookbehind เพราะ Safari เก่าบน iPhone ไม่รองรับ) · คำอังกฤษสั้นใช้ขอบเขตคำ
  // ขั้นที่ไม่ตรงคำใดเลยใช้สถานีของขั้น RB ก่อนหน้า (ขั้นย่อยของงานเดียวกัน) ถ้าเป็นขั้นแรกใช้ "ผสมยาง" และติดธง inferred
  const STAGE_RULES = Object.freeze([
    ["curing", /(?:^|[^฀-๿])อบ|วัลคาไนซ์|oven|hcm|vulcan|\bcur(?:e|ing)\b|autoclave/i],
    ["forming", /ฉีด|รีด|ขึ้นรูป|extru|inject|calender|mold|mould/i],
    ["finishing", /ตัด|ตกแต่ง|ตรวจ|บรรจุ|แพ็ค|finish|trim|\bcut\b|\bpack/i],
    ["mixing", /ชั่ง|ผสม|ตียาง|พักยาง|เคมี|แบ่งยาง|บดยาง|\bmix|knead|banbury|weigh|\brest\b/i],
  ]);

  // สถานีจากชื่อขั้น — ไม่ตรงคำใดคืน null
  function stageOf(name) {
    const text = String(name ?? "");
    for (const [key, pattern] of STAGE_RULES) if (pattern.test(text)) return key;
    return null;
  }

  const model = () => root.MNP_FACTORY_JOB_MODEL;
  const isRbStep = (step) => step?.department_code === DEPARTMENT;

  // ขั้นทั้งหมดของใบงานพร้อมสถานี: ขั้นของ RB ได้สถานีจากชื่อ (หรืออนุมานจากขั้น RB ก่อนหน้า) ขั้นของแผนกอื่นได้ stage null
  function classifySteps(job) {
    let previous = null;
    return model().stepsOf(job).map((step) => {
      if (!isRbStep(step)) return { step, stage: null, inferred: false };
      const matched = stageOf(step.name);
      const stage = matched ?? previous ?? STAGE_KEYS[0];
      previous = stage;
      return { step, stage, inferred: !matched };
    });
  }

  const hasRbSteps = (job) => model().stepsOf(job).some(isRbStep);
  // ชั่วโมงพักยางจากชื่อขั้น ("พักยาง 4 ชั่วโมง") ถ้าไม่มีใช้ run_minutes ของขั้น
  const REST_STEP = /พักยาง|พัก\s*\d|\brest\b/i;
  function restMinutes(step) {
    const hours = String(step?.name ?? "").match(/(\d+(?:\.\d+)?)\s*(?:ชั่วโมง|ชม\.?|h(?:our)?s?\b)/i);
    if (hours) return Number(hours[1]) * 60;
    const minutes = String(step?.name ?? "").match(/(\d+(?:\.\d+)?)\s*(?:นาที|min)/i);
    if (minutes) return Number(minutes[1]);
    const run = Number(step?.run_minutes);
    return Number.isFinite(run) && run > 0 ? run : null;
  }

  // ขั้นพักยางที่ถึงคิว: นับจากเวลาที่ขั้นก่อนหน้าเสร็จ + เวลาพัก คืน { readyAt, remainingMs, minutes } หรือ null ถ้าไม่ใช่ขั้นพัก/ไม่มีเวลาอ้างอิง
  // เป็นคำแนะนำบนหน้าจอเท่านั้น ฐานข้อมูลไม่ได้บังคับเวลาพัก (ดูข้อจำกัดใน README)
  function restTimer(job, step, now) {
    if (!step || !REST_STEP.test(String(step.name ?? ""))) return null;
    const minutes = restMinutes(step);
    const steps = model().stepsOf(job);
    const index = steps.findIndex((row) => row.sequence === step.sequence);
    const previous = index > 0 ? steps[index - 1] : null;
    const from = Date.parse(previous?.completed_at ?? job?.started_at ?? "");
    if (!minutes || !Number.isFinite(from)) return null;
    const readyAt = from + minutes * 60000;
    return { readyAt: new Date(readyAt).toISOString(), remainingMs: Math.max(0, readyAt - Number(now)), minutes };
  }

  // ความคืบหน้าในสาย RB: ขั้นของ RB ที่เสร็จ/ทั้งหมด
  function rbProgress(job) {
    const steps = model().stepsOf(job).filter(isRbStep);
    const done = steps.filter((step) => step.status === "done").length;
    return { done, total: steps.length };
  }

  const byOldest = (a, b) => String(a.job.created_at ?? "").localeCompare(String(b.job.created_at ?? "")) || String(a.job.code).localeCompare(String(b.job.code));

  // กระดานสถานีของ RB จากใบงานทั้งหมด (now = เวลาปัจจุบันเป็น ms สำหรับนาฬิกาพักยาง)
  //   stations[]  { stage, label, hint, ready[], held[] }  ready = ถึงคิวสถานีนี้ ทำได้ · held = ถึงคิวแต่ถูกกักกันรอ QA (ทำไม่ได้)
  //   handed[]    ใบงานที่ขั้นของ RB เสร็จหมดแล้วและยังไม่จบ = ส่งต่อแผนกถัดไป (SR/QC/…) พร้อมขั้นที่กำลังรออยู่ (held = ถูกกักกันตอนปิดขั้นสุดท้ายของ RB)
  //   waiting[]   ใบงานที่ขั้นถัดไปเป็นของแผนกอื่น แต่ RB ยังมีขั้นรอทำทีหลัง (รอแผนกอื่นก่อน)
  //   completed[] ใบงานที่เสร็จแล้ว (รับผลผลิตเข้าคลังแล้ว) ที่มีขั้นของ RB
  //   summary     { active, held, handed, completed, yieldPercent } held นับทุกใบที่ถูกกักกันในสาย (ที่สถานี ส่งต่อแล้ว และรอแผนกอื่น)
  //               yieldPercent = Σ ผลิตจริง / Σ จำนวนสั่ง ของใบที่เสร็จ (null ถ้าไม่มี)
  // แต่ละรายการ: { job, step, stage, inferred, rest, held, progress }
  function board(jobs, now = Date.now()) {
    const jobModel = model();
    const stations = STAGES.map((stage) => ({ ...stage, stage: stage.key, ready: [], held: [] }));
    const handed = [];
    const waiting = [];
    const completed = [];
    for (const job of jobs ?? []) {
      if (!hasRbSteps(job)) continue;
      if (job.status === "completed") { completed.push({ job, progress: rbProgress(job) }); continue; }
      if (!jobModel.isActive(job)) continue;
      const next = jobModel.nextStep(job);
      if (!next) continue;
      const classified = classifySteps(job);
      const held = jobModel.isHeld(job);
      const progress = rbProgress(job);
      if (isRbStep(next)) {
        const { stage, inferred } = classified.find((row) => row.step.sequence === next.sequence);
        const entry = { job, step: next, stage, inferred, rest: restTimer(job, next, now), held, progress };
        const station = stations.find((row) => row.stage === stage);
        (held ? station.held : station.ready).push(entry);
      } else if (classified.some((row) => row.step.status === "pending" && isRbStep(row.step))) {
        waiting.push({ job, step: next, stage: null, inferred: false, rest: null, held, progress });
      } else {
        handed.push({ job, step: next, stage: null, inferred: false, rest: null, held, progress });
      }
    }
    for (const station of stations) { station.ready.sort(byOldest); station.held.sort(byOldest); }
    handed.sort(byOldest);
    waiting.sort(byOldest);
    completed.sort((a, b) => String(b.job.completed_at ?? "").localeCompare(String(a.job.completed_at ?? "")) || String(b.job.code).localeCompare(String(a.job.code)));
    const ordered = completed.reduce((sum, row) => sum + Number(row.job.qty ?? 0), 0);
    const produced = completed.reduce((sum, row) => sum + Number(row.job.output_qty ?? row.job.qty ?? 0), 0);
    const summary = {
      active: stations.reduce((sum, station) => sum + station.ready.length + station.held.length, 0) + waiting.length,
      held: stations.reduce((sum, station) => sum + station.held.length, 0) + [...handed, ...waiting].filter((entry) => entry.held).length,
      handed: handed.length,
      completed: completed.length,
      yieldPercent: ordered > 0 ? Math.round((produced / ordered) * 1000) / 10 : null,
    };
    return { stations, handed, waiting, completed, summary };
  }

  // สถานีที่เลือก: ค่าจาก URL ถ้ารู้จัก · ไม่เช่นนั้นสถานีแรกที่มีงาน (ถึงคิวหรือกักกัน) · ไม่มีงานเลยใช้สถานีแรก
  function pickStation(stations, wanted) {
    const chosen = stations.find((station) => station.stage === String(wanted ?? ""));
    if (chosen) return chosen;
    return stations.find((station) => station.ready.length || station.held.length) ?? stations[0];
  }

  // ลิงก์ของหน้า RB — ใส่เฉพาะค่าที่มี (st = สถานี, jb = ใบงานที่เปิดฟอร์มทำขั้นตอน)
  function url({ st = null, jb = null } = {}) {
    const query = new URLSearchParams({ dept: DEPARTMENT });
    if (st && STAGE_KEYS.includes(st)) query.set("st", st);
    if (jb) query.set("jb", String(jb));
    return `#/factory?${query}`;
  }

  // แสดงเวลาที่เหลือของนาฬิกาพักยาง
  function remainingText(remainingMs) {
    const minutes = Math.ceil(Number(remainingMs) / 60000);
    if (!(minutes > 0)) return "ครบเวลาพักแล้ว";
    const hours = Math.floor(minutes / 60);
    return hours ? `พักอีก ${hours} ชม. ${minutes % 60} นาที` : `พักอีก ${minutes} นาที`;
  }

  const api = { DEPARTMENT, STAGES, STAGE_KEYS, STAGE_RULES, stageInfo, stageOf, classifySteps, hasRbSteps, restMinutes, restTimer, rbProgress, board, pickStation, url, remainingText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_RB_FLOW = api;
})(typeof window !== "undefined" ? window : globalThis);
