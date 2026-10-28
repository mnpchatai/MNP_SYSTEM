// SPC / Cpk ของค่าพารามิเตอร์ที่บันทึกตอนปิดขั้นของใบงาน (ฝ่ายโรงงาน โหมดทดสอบ) — ไม่มี DOM/Supabase
// เทสต์ที่ scripts/tests/factory-spc-model.test.mjs
//
// ที่มา: หน้า SPC ของต้นแบบ prototypes/rubber-mes (src/pages/Spc.jsx, stats ใน src/lib/rules.js) ย้ายมาใช้กับค่าจริงในระบบ
// ค่ามาจาก job_readings ของ app_factory_master_data (20261029010000_factory_step_params_auto_hold.sql) ไม่มี migration/RPC ใหม่
// หน้านี้อ่านอย่างเดียว ไม่ใช่การควบคุมสิทธิ์ และไม่เปลี่ยนการกักกันใบงาน (ฐานข้อมูลตัดสินจาก min/max ตอนบันทึกเอง)
//
// ค่าที่ติดตาม (characteristic) = พารามิเตอร์หนึ่งรหัสของขั้นหนึ่งใน Routing หนึ่ง (Routing คนละ Revision แยกชุดกัน)
// เรียงค่าตามเวลาที่บันทึก เส้นควบคุมแบบ I-MR ใช้ controlLimits ของ modules/lab-mooney-model.js (σ = MR̄ / d2) ตัวเดียวกับแล็บ
//   Cp / Cpk ใช้ σ ภายใน (จากช่วงเคลื่อนที่) · Ppk ใช้ SD รวมของทุกค่า · สเปกด้านเดียวมีแค่ Cpk/Ppk (Cp ต้องมีทั้งสองด้าน)
// สเปกที่ใช้คือสเปกปัจจุบันของขั้นใน Routing (พารามิเตอร์ถูกลบไปแล้ว = สเปกที่บันทึกไว้กับค่าล่าสุด)
// ค่าที่บันทึกตอนสเปกยังเป็นค่าอื่นถูกนับใน specChanged ให้หน้าเว็บเตือน
(function (root) {
  // modules/lab-mooney-model.js ตั้ง MNP_LAB_MOONEY เองทั้งใน browser (โหลดก่อนไฟล์นี้ใน index.html) และ node (เทสต์ require ก่อนเรียก)
  const lab = () => root.MNP_LAB_MOONEY;

  // ต่ำกว่านี้ Cpk แกว่งมากจากค่าชุดถัดไป ใช้ดูแนวโน้มเท่านั้น
  const MIN_SAMPLE = 25;
  const VERDICTS = Object.freeze([
    { min: 1.67, tone: "good", text: "ดีมาก (≥ 1.67)" },
    { min: 1.33, tone: "good", text: "ผ่านเกณฑ์ (≥ 1.33)" },
    { min: 1, tone: "warn", text: "ควรเฝ้าระวัง (1.00–1.33)" },
    { min: -Infinity, tone: "bad", text: "ไม่ผ่าน (< 1.00)" },
  ]);

  const limit = (value) => (value === null || value === undefined || value === "" ? null : Number(value));
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const sameSpec = (a, b) => a.min === b.min && a.max === b.max;
  const outside = (value, spec) => (spec.min !== null && value < spec.min) || (spec.max !== null && value > spec.max);
  const byTime = (a, b) => String(a.recorded_at ?? "").localeCompare(String(b.recorded_at ?? "")) || String(a.job_code).localeCompare(String(b.job_code));

  // job_readings + jobs + steps ของ app_factory_master_data -> รายการค่าที่ติดตาม พร้อมจุดข้อมูลเรียงตามเวลา
  // ค่าที่ไม่ใช่ตัวเลข หรือใบงานที่ไม่อยู่ในชุดข้อมูล ถูกข้าม
  function characteristics(data) {
    const jobs = new Map((data?.jobs ?? []).map((job) => [job.id, job]));
    const routingSteps = new Map((data?.steps ?? []).map((step) => [`${step.routing_id}:${step.sequence}`, step]));
    const groups = new Map();
    for (const row of data?.job_readings ?? []) {
      const job = jobs.get(row.job_id);
      const value = limit(row.value);
      if (!job || !finite(value)) continue;
      const key = `${job.routing_id}:${row.step_sequence}:${row.code}`;
      let group = groups.get(key);
      if (!group) {
        const step = routingSteps.get(`${job.routing_id}:${row.step_sequence}`);
        const params = step?.params ?? [];
        const position = params.findIndex((param) => param.code === row.code);
        // current = พารามิเตอร์ในสเปกปัจจุบันของ Routing (ถูกลบแล้ว = null) · order = ลำดับในขั้นตามที่ฝ่ายวางแผนตั้ง (ถูกลบแล้วไว้ท้าย)
        group = {
          info: {
            key, routing_id: job.routing_id, routing_revision: job.routing_revision, item_code: job.item_code, item_name: job.item_name,
            step_sequence: row.step_sequence, step_name: step?.name ?? (job.steps ?? []).find((s) => s.sequence === row.step_sequence)?.name ?? "",
            code: row.code,
          },
          current: position >= 0 ? params[position] : null, order: position >= 0 ? position : params.length, points: [],
        };
        groups.set(key, group);
      }
      group.points.push({
        value, job_id: job.id, job_code: job.code, recorded_at: row.recorded_at, recorded_by_name: row.recorded_by_name ?? null,
        label: row.label, unit: row.unit ?? "", spec: { min: limit(row.min), max: limit(row.max) },
      });
    }
    const ranked = [...groups.values()].sort((a, b) => String(a.info.item_code).localeCompare(String(b.info.item_code))
      || (a.info.routing_revision ?? 0) - (b.info.routing_revision ?? 0) || a.info.step_sequence - b.info.step_sequence
      || a.order - b.order || String(a.info.code).localeCompare(String(b.info.code)));
    return ranked.map(({ info, current, points }) => {
      points.sort(byTime);
      const last = points.at(-1);
      const spec = current ? { min: limit(current.min), max: limit(current.max) } : last.spec;
      return {
        ...info, label: current?.label ?? last.label, unit: current?.unit ?? last.unit, spec, specFromRouting: Boolean(current),
        specChanged: points.filter((point) => !sameSpec(point.spec, spec)).length, points,
      };
    });
  }

  // ชื่อใน dropdown: Item · ขั้น · พารามิเตอร์ (หน่วย) ใส่ Revision เฉพาะเมื่อมีชุดอื่นชื่อเดียวกันจาก Routing คนละ Revision
  function choiceLabels(groups) {
    const base = (group) => `${group.item_code} · ${group.step_sequence} ${group.step_name} · ${group.label}${group.unit ? ` (${group.unit})` : ""}`;
    const counts = new Map();
    for (const group of groups) counts.set(base(group), (counts.get(base(group)) ?? 0) + 1);
    return groups.map((group) => [group.key, counts.get(base(group)) > 1 ? `${base(group)} · Rev ${group.routing_revision}` : base(group)]);
  }

  // ดัชนีความสามารถจาก σ หนึ่งค่า: p = Cp (ต้องมีสเปกสองด้าน) · pk = Cpk ด้านที่ใกล้กว่า
  function indices(mean, sigma, spec) {
    if (!(sigma > 0)) return { p: null, pk: null };
    const upper = spec.max === null ? null : (spec.max - mean) / (3 * sigma);
    const lower = spec.min === null ? null : (mean - spec.min) / (3 * sigma);
    return {
      p: spec.min !== null && spec.max !== null ? (spec.max - spec.min) / (6 * sigma) : null,
      pk: upper === null ? lower : lower === null ? upper : Math.min(upper, lower),
    };
  }

  // สถิติของค่าตามลำดับเวลา: เส้นควบคุม I-MR, Cp/Cpk (σ ภายใน), Ppk (SD รวม) และตำแหน่งจุดที่ผิดปกติ
  // reason: null = คำนวณได้ · "few" = ค่าน้อยกว่า 2 ตัว · "flat" = ทุกค่าเท่ากัน (σ = 0)
  function capability(values, spec) {
    const list = (values ?? []).filter(finite);
    const { mean, sd, min, max } = lab().describe(list);
    const control = lab().controlLimits(list);
    const within = indices(mean, control?.sigma ?? 0, spec);
    return {
      n: list.length, mean, sd, min, max,
      sigma: control?.sigma ?? null, ucl: control?.ucl ?? null, lcl: control?.lcl ?? null,
      cp: within.p, cpk: within.pk, ppk: indices(mean, sd ?? 0, spec).pk,
      reason: list.length < 2 ? "few" : control ? null : "flat",
      outOfControl: control ? list.flatMap((value, index) => (value > control.ucl || value < control.lcl ? [index] : [])) : [],
      outOfSpec: list.flatMap((value, index) => (outside(value, spec) ? [index] : [])),
    };
  }

  // คำตัดสิน Cpk: tone ใช้เลือกสี · provisional = ค่ายังน้อยกว่า MIN_SAMPLE
  function verdict(stats) {
    if (stats.cpk === null) return { tone: "none", text: stats.reason === "flat" ? "ค่าทุกตัวเท่ากัน" : "ข้อมูลไม่พอ", provisional: false };
    const found = VERDICTS.find((entry) => stats.cpk >= entry.min);
    return { tone: found.tone, text: found.text, provisional: stats.n < MIN_SAMPLE };
  }

  // ฮิสโตแกรม: ช่วงครอบทั้งค่าและสเปก จำนวนช่อง = √n (5–12 ช่อง) ค่าที่ตกขอบขวาสุดนับในช่องสุดท้าย
  function histogram(values, spec) {
    const list = (values ?? []).filter(finite);
    if (!list.length) return [];
    let low = Math.min(...list, spec.min ?? Infinity);
    let high = Math.max(...list, spec.max ?? -Infinity);
    if (high === low) { low -= 0.5; high += 0.5; }
    const count = Math.min(12, Math.max(5, Math.ceil(Math.sqrt(list.length))));
    const width = (high - low) / count;
    const bins = Array.from({ length: count }, (_, index) => ({ from: low + width * index, to: low + width * (index + 1), count: 0 }));
    for (const value of list) bins[Math.min(count - 1, Math.floor((value - low) / width))].count += 1;
    return bins;
  }

  const api = { MIN_SAMPLE, VERDICTS, characteristics, choiceLabels, capability, verdict, histogram };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_SPC_MODEL = api;
})(typeof window !== "undefined" ? window : globalThis);
