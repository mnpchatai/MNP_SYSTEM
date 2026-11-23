// รายงานทดสอบ MDR ของ MNP LAB — อ่านไฟล์ .ini ของเครื่อง MDR คำนวณผลจากกราฟ และสรุป AVG/SD ต่อวัน ข้อมูลล้วน ไม่มี DOM/Supabase
// เทสต์ที่ scripts/tests/lab-mdr-model.test.mjs
//
// ไฟล์ .ini หนึ่งไฟล์ = การทดสอบหนึ่งครั้ง: หัวไฟล์ "key value" (ID, Name, Testdate, Testtime, Testtemperature, Settime, MH, ML, T5…, TS1, TS2,
// VC1, VC2, Result) ตามด้วยบรรทัด "T,s F,M T,s F,M T1 T2" แล้วหนึ่งแถวต่อวินาที: ลำดับ แรงบิดก่อนหน้า วินาที แรงบิด อุณหภูมิแม่พิมพ์บน/ล่าง
// ชื่อ (Name ตัดช่องว่างหัวท้าย) ลงท้าย F1 = ทดสอบการสุกของยาง, F2 = ทดสอบการพองตัวของยาง, ชื่ออื่นข้ามและบอกเหตุผล
// สูตร = ชื่อที่ตัด F1/F2 ออก (A2004F1 → A2004) ซ้ำกันเมื่อชื่อ + วันที่ + เวลา + ID ตรงกัน (ฐานข้อมูลใช้คีย์เดียวกัน)
//
// F1: หัวไฟล์บางไฟล์ใส่ชื่อ T ผิดตำแหน่ง (T10 T30 T50 T90 ไม่มี T100 ทั้งที่ค่าจริงคือ T30 T50 T90 T100) จึงคำนวณจากกราฟ:
//   ML/MH = แรงบิดต่ำสุด/สูงสุด, ts1/ts2 = วินาทีแรกหลังจุดต่ำสุดที่แรงบิด ≥ ML+1/ML+2 dNm, tx = วินาทีแรกหลังจุดต่ำสุดที่ ≥ ML + x%·(MH−ML)
//   ตรวจกับไฟล์จริง 141 ไฟล์ (ส.ค.–พ.ย. 2569) ตรงกับค่าที่เครื่องแสดงทุกไฟล์ ยกเว้น 2 ค่าที่ต่างกัน 1 วินาที
// F2: เครื่องบันทึกเฉพาะหัวไฟล์ (ไม่มีกราฟ ไม่มี TS) จึงใช้ค่าจากหัวไฟล์ เวลา 0:00 = ไม่ได้วัด และแก้ชื่อ T ที่เลื่อนแบบเดียวกัน
(function (root) {
  const MAX_FILE_BYTES = 1024 * 1024;
  const MAX_POINTS = 7201; // 120 นาที ทุก 1 วินาที (ตรงกับข้อจำกัดของฐานข้อมูล)
  const UPLOAD_BATCH = 20; // ต่อคำขอ (ฐานข้อมูลรับไม่เกิน 25) ไฟล์ละ ~13–50 KB เมื่อเป็น JSON
  const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}F[12]$/;
  const CURVE_SLACK_S = 5; // กราฟสั้นกว่าเวลาทดสอบได้ไม่เกินเท่านี้
  // F2 ที่ยางไม่พองตัว (ค่าตั้งต้นที่เสนอเจ้าของงาน 2026-11-23): MH−ML น้อยกว่า 1% ของ ML หรือ t90 ถึงเวลาทดสอบ − 10 วินาที = เครื่องเขียน t50/t90 เป็นเวลาจบการทดสอบ
  const NO_SWELL_RISE = 0.01;
  const NO_SWELL_END_S = 10;
  const MIN_BAND_TESTS = 10; // ช่วงปกติ (AVG ± 2SD) ต้องมีผลอย่างน้อยเท่านี้ในเงื่อนไขเดียวกัน

  // ชุดทดสอบ: ลำดับนี้ = ลำดับแท็บในหน้า · unit = หน่วยของ ML/MH (F2 เครื่องไม่ระบุหน่วย จึงไม่แสดง)
  const PARTS = Object.freeze([
    Object.freeze({ key: "F1", label: "ทดสอบการสุกของยาง", unit: "dNm", hasCurve: true }),
    Object.freeze({ key: "F2", label: "ทดสอบการพองตัวของยาง", unit: "", hasCurve: false }),
  ]);
  const findPart = (key) => PARTS.find((part) => part.key === key) ?? null;

  // ค่าที่สรุป AVG/SD ต่อวัน (ตามที่ห้อง LAB ใช้) kind: torque = ตัวเลข, time = วินาที (แสดง m:ss)
  const METRICS = Object.freeze([
    Object.freeze({ key: "ml", label: "ML", kind: "torque" }),
    Object.freeze({ key: "mh", label: "MH", kind: "torque" }),
    Object.freeze({ key: "delta", label: "MH−ML", kind: "torque" }),
    Object.freeze({ key: "ts2_s", label: "ts2", kind: "time" }),
    Object.freeze({ key: "t90_s", label: "t90", kind: "time" }),
  ]);

  const SKIP = Object.freeze({
    notIni: "ไม่ใช่ไฟล์ .ini",
    tooBig: "ไฟล์ใหญ่เกิน 1 MB",
    noSuffix: "ชื่อสูตรไม่ลงท้ายด้วย F1 หรือ F2",
    badName: "ชื่อสูตรมีอักขระที่ระบบไม่รองรับ",
    unreadable: "อ่านหัวไฟล์ไม่ได้ (ไม่มี ID, Name, Testdate หรือ Testtime)",
    badCurve: "ข้อมูลกราฟไม่ครบหรือผิดรูปแบบ",
    noCurve: "ไม่มีข้อมูลกราฟ",
    badValues: "ผลไม่สมบูรณ์ (MH ต่ำกว่า ML หรือไม่มีค่า)",
    curveTooLong: "กราฟยาวเกิน 120 นาที",
    curveTooShort: "กราฟสั้นกว่าเวลาทดสอบ (เครื่องหยุดก่อนครบเวลา)",
    sameInBatch: "ไฟล์ซ้ำกันในชุดที่เลือก",
  });

  const num = (value) => {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const parsed = Number(String(value).trim());
    return Number.isFinite(parsed) ? parsed : null;
  };
  // "m:ss" → วินาที · "0:00" = ไม่ได้วัด (null)
  function parseClock(value) {
    const match = /^(\d{1,3}):([0-5]\d)$/.exec(String(value ?? "").trim());
    if (!match) return null;
    const seconds = Number(match[1]) * 60 + Number(match[2]);
    return seconds > 0 ? seconds : null;
  }

  function splitName(rawName) {
    const name = String(rawName ?? "").trim();
    const suffix = /F([12])$/.exec(name);
    if (!suffix || name.length <= 2) return { name, error: SKIP.noSuffix };
    if (!NAME_PATTERN.test(name)) return { name, error: SKIP.badName };
    return { name, formula: name.slice(0, -2), part: `F${suffix[1]}` };
  }

  // ผลการสุกจากกราฟ (แรงบิดทุก 1 วินาที เริ่มวินาที 0) เวลาที่ไม่ถึงเกณฑ์ภายในการทดสอบ = null
  function cureFromCurve(curve) {
    let low = 0;
    let high = 0;
    for (let index = 1; index < curve.length; index += 1) {
      if (curve[index] < curve[low]) low = index;
      if (curve[index] > curve[high]) high = index;
    }
    const ml = curve[low];
    const mh = curve[high];
    const reach = (threshold) => {
      for (let index = low; index < curve.length; index += 1) if (curve[index] >= threshold) return index;
      return null;
    };
    const at = (percent) => reach(ml + (percent / 100) * (mh - ml));
    return { ml, mh, ts1_s: reach(ml + 1), ts2_s: reach(ml + 2), t50_s: at(50), t90_s: at(90) };
  }

  // หัวไฟล์ที่ชื่อ T เลื่อน (มี T10 ไม่มี T100) → ชื่อจริงของแต่ละค่า
  function headerTimes(header) {
    const shifted = !("T100" in header) && "T10" in header;
    const pick = (label) => parseClock(header[label]);
    return shifted
      ? { t50_s: pick("T30"), t90_s: pick("T50") }
      : { t50_s: pick("T50"), t90_s: pick("T90") };
  }

  // อ่านไฟล์หนึ่งไฟล์ → { ok: true, test } หรือ { ok: false, reason, name }
  // test = รูปแบบเดียวกับที่ app_lab_mdr_upload รับ + formula/part/key สำหรับหน้าเว็บ
  function parseIni(text) {
    const lines = String(text ?? "").split(/\r?\n/);
    const header = {};
    let row = 0;
    for (; row < lines.length; row += 1) {
      const line = lines[row];
      if (/^T,s\b/.test(line)) break;
      const match = /^([A-Za-z][A-Za-z0-9]*)[ \t]?(.*)$/.exec(line);
      if (match && Object.keys(header).length < 40) header[match[1]] = match[2].slice(0, 80);
    }
    const id = String(header.ID ?? "").trim();
    const date = String(header.Testdate ?? "").trim();
    const time = String(header.Testtime ?? "").trim();
    if (!("Name" in header) || !/^[A-Za-z0-9]{1,12}$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)
      || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      return { ok: false, reason: SKIP.unreadable, name: String(header.Name ?? "").trim() };
    }
    const named = splitName(header.Name);
    if (named.error) return { ok: false, reason: named.error, name: named.name };

    const curve = [];
    for (row += 1; row < lines.length; row += 1) {
      const line = lines[row].trim();
      if (!line) continue;
      const cells = line.split(/\s+/);
      const second = Number(cells[2]);
      const torque = Number(cells[3]);
      if (cells.length < 4 || second !== curve.length || !Number.isFinite(torque) || torque < -100 || torque > 1000) {
        return { ok: false, reason: SKIP.badCurve, name: named.name };
      }
      if (curve.length >= MAX_POINTS) return { ok: false, reason: SKIP.curveTooLong, name: named.name };
      curve.push(torque);
    }
    const part = findPart(named.part);
    let values;
    if (curve.length > 0) {
      if (curve.length < 10) return { ok: false, reason: SKIP.badCurve, name: named.name };
      values = cureFromCurve(curve);
    } else {
      if (part.hasCurve) return { ok: false, reason: SKIP.noCurve, name: named.name };
      const ml = num(header.ML);
      const mh = num(header.MH);
      if (ml === null || mh === null || ml < 0 || mh < ml) return { ok: false, reason: SKIP.badValues, name: named.name };
      values = { ml, mh, ts1_s: parseClock(header.TS1), ts2_s: parseClock(header.TS2), ...headerTimes(header) };
    }
    const temperature = num(header.Testtemperature);
    const setMinutes = num(header.Settime);
    if (temperature === null || setMinutes === null || temperature < 0 || temperature > 300 || setMinutes < 0 || setMinutes > 600) {
      return { ok: false, reason: SKIP.unreadable, name: named.name };
    }
    // กราฟ n จุด = n − 1 วินาที · ไฟล์จริงทุกไฟล์ยาวเท่าเวลาทดสอบพอดี กราฟที่สั้นกว่าเวลาทดสอบเกิน 5 วินาที = เครื่องหยุดกลางคัน ผลจากกราฟเชื่อไม่ได้
    if (curve.length > 0 && curve.length - 1 < setMinutes * 60 - CURVE_SLACK_S) return { ok: false, reason: SKIP.curveTooShort, name: named.name };
    const test = {
      name: named.name,
      machine_id: id,
      test_date: date,
      test_time: time,
      temperature_c: temperature,
      set_minutes: setMinutes,
      ...values,
      vc1: num(header.VC1),
      vc2: num(header.VC2),
      result: String(header.Result ?? "").trim().slice(0, 20) || null,
      curve: curve.length > 0 ? curve : null,
      header,
    };
    return { ok: true, test, formula: named.formula, part: named.part, key: testKey(test) };
  }

  const testKey = (test) => [test.name, test.test_date, test.test_time, test.machine_id].join("|");

  // ไฟล์ที่ผู้ใช้เลือก [{ name, size, text }] → ไฟล์ที่ส่งได้ + ไฟล์ที่ข้ามพร้อมเหตุผล (ไม่มีไฟล์ใดหายเงียบ)
  // text = null สำหรับไฟล์ที่ไม่ได้อ่าน (ไม่ใช่ .ini หรือใหญ่เกิน)
  function classifyFiles(files) {
    const accepted = [];
    const skipped = [];
    const seen = new Set();
    for (const file of files) {
      const fileName = String(file.name ?? "");
      if (!/\.ini$/i.test(fileName)) { skipped.push({ file: fileName, reason: SKIP.notIni }); continue; }
      if (file.size > MAX_FILE_BYTES || file.text === null) { skipped.push({ file: fileName, reason: SKIP.tooBig }); continue; }
      const parsed = parseIni(file.text);
      if (!parsed.ok) { skipped.push({ file: fileName, name: parsed.name, reason: parsed.reason }); continue; }
      if (seen.has(parsed.key)) { skipped.push({ file: fileName, name: parsed.test.name, reason: SKIP.sameInBatch }); continue; }
      seen.add(parsed.key);
      accepted.push({ file: fileName, ...parsed });
    }
    return { accepted, skipped };
  }

  // เหตุผลที่ข้าม → [{ reason, files: [...] }] เรียงตามจำนวนมากไปน้อย
  function groupSkipped(skipped) {
    const groups = new Map();
    for (const item of skipped) {
      if (!groups.has(item.reason)) groups.set(item.reason, []);
      groups.get(item.reason).push(item.file);
    }
    return [...groups].map(([reason, files]) => ({ reason, files })).sort((a, b) => b.files.length - a.files.length);
  }

  function chunk(items, size = UPLOAD_BATCH) {
    const out = [];
    for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
    return out;
  }

  /* ---------- สถิติ ---------- */

  const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  // ส่วนเบี่ยงเบนมาตรฐานของตัวอย่าง (n−1) เหมือน STDEV ของ Excel · น้อยกว่า 2 ค่า = null
  function sampleSd(values) {
    if (values.length < 2) return null;
    const average = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
  }

  const metricValue = (test, key) => {
    if (key === "delta") return Number.isFinite(test.mh) && Number.isFinite(test.ml) ? test.mh - test.ml : null;
    const value = test[key];
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
  };

  function summarize(tests) {
    const out = {};
    for (const metric of METRICS) {
      const values = tests.map((test) => metricValue(test, metric.key)).filter((value) => value !== null);
      out[metric.key] = { avg: mean(values), sd: sampleSd(values), n: values.length };
    }
    return out;
  }

  /* ---------- เงื่อนไขการทดสอบ (เวลาทดสอบ + อุณหภูมิ) ---------- */
  // ผลต่างเงื่อนไขกันเทียบกันไม่ได้ (เช่น SEP003 วันที่ 12 พ.ย. 30 นาที MH 15.65 / 40 นาที MH 16.65–17.03) จึงเฉลี่ย ทำกราฟแนวโน้ม และช่วงปกติแยกตามเงื่อนไข
  const conditionKey = (test) => `${test.set_minutes ?? "-"}|${test.temperature_c ?? "-"}`;
  function formatCondition(condition) {
    const time = Number.isFinite(condition?.set_minutes) ? `${condition.set_minutes} นาที` : "ไม่ระบุเวลาทดสอบ";
    const heat = Number.isFinite(condition?.temperature_c) ? ` · ${condition.temperature_c} °C` : "";
    return `${time}${heat}`;
  }
  // เงื่อนไขทั้งหมดของผล [{ key, set_minutes, temperature_c, n }] มากครั้งก่อน (เท่ากัน = เวลาทดสอบสั้นก่อน)
  function conditionsOf(tests) {
    const found = new Map();
    for (const test of tests) {
      const key = conditionKey(test);
      if (!found.has(key)) found.set(key, { key, set_minutes: test.set_minutes ?? null, temperature_c: test.temperature_c ?? null, n: 0 });
      found.get(key).n += 1;
    }
    return [...found.values()].sort((a, b) => b.n - a.n || (a.set_minutes ?? 0) - (b.set_minutes ?? 0) || (a.temperature_c ?? 0) - (b.temperature_c ?? 0));
  }

  // ผลจากฟีด → [{ date, tests, groups: [{ key, set_minutes, temperature_c, tests, stats }] }] วันล่าสุดก่อน ในวันเรียงตามเวลา (ลำดับเดียวกับเครื่อง)
  // AVG/SD ต่อ (วัน, เงื่อนไข) ไม่ใช่ต่อวัน กลุ่มในวันเรียงตามครั้งแรกของกลุ่ม
  function groupByDate(tests) {
    const days = new Map();
    for (const test of tests) {
      if (!days.has(test.test_date)) days.set(test.test_date, []);
      days.get(test.test_date).push(test);
    }
    return [...days]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, items]) => {
        const sorted = [...items].sort((a, b) => a.test_time.localeCompare(b.test_time) || a.machine_id.localeCompare(b.machine_id, "en", { numeric: true }));
        const groups = new Map();
        for (const test of sorted) {
          const key = conditionKey(test);
          if (!groups.has(key)) groups.set(key, { key, set_minutes: test.set_minutes ?? null, temperature_c: test.temperature_c ?? null, tests: [] });
          groups.get(key).tests.push(test);
        }
        return { date, tests: sorted, groups: [...groups.values()].map((group) => ({ ...group, stats: summarize(group.tests) })) };
      });
  }
  // มีค่า key ในผลอย่างน้อยหนึ่งครั้ง (คอลัมน์/ปุ่มที่ว่างทั้งหมดไม่แสดง)
  const hasMetric = (days, key) => days.some((day) => day.tests.some((test) => metricValue(test, key) !== null));

  /* ---------- F2: ยางไม่พองตัว ---------- */
  // เครื่องเขียน t50/t90 = เวลาจบการทดสอบ เมื่อแรงบิดแทบไม่ขึ้น (A2401 F2 14 พ.ย.: ML 6092 / MH 6097 t90 29:57) ค่านั้นไม่ใช่ผลวัด
  // ใช้ตอนแสดงผลกับแถวที่เก็บไว้ ไม่แก้ข้อมูลในฐานข้อมูล: t50/t90 = null (แสดง "–" ไม่นับใน AVG/SD กราฟ และช่วงปกติ) ML/MH คงไว้
  function noSwell(test) {
    const { ml, mh } = test;
    const flat = Number.isFinite(ml) && Number.isFinite(mh) && ml > 0 && mh - ml < NO_SWELL_RISE * ml;
    const end = Number.isFinite(test.set_minutes) ? test.set_minutes * 60 - NO_SWELL_END_S : null;
    const atEnd = end !== null && Number.isFinite(test.t90_s) && test.t90_s >= end;
    return flat || atEnd;
  }
  function applyDisplayRules(tests, partKey) {
    if (partKey !== "F2") return tests;
    return tests.map((test) => (noSwell(test) ? { ...test, t50_s: null, t90_s: null, no_swell: true, t90_raw: test.t90_s } : test));
  }

  // ฟีดจากฐานข้อมูล → ตัวเลขเป็น number (numeric ของ Postgres อาจมาเป็นข้อความ)
  function normalizeTests(rows) {
    const numeric = ["temperature_c", "set_minutes", "ml", "mh", "ts1_s", "ts2_s", "t50_s", "t90_s", "vc1", "vc2"];
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const test = { ...row, machine_id: String(row.machine_id ?? ""), test_date: String(row.test_date ?? ""), test_time: String(row.test_time ?? "").slice(0, 5) };
      for (const key of numeric) test[key] = num(row[key]);
      return test;
    });
  }

  /* ---------- รูปแบบตัวเลข ---------- */

  function formatClock(seconds) {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "–";
    const rounded = Math.round(seconds);
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
  }
  // F1 (dNm) 2 ตำแหน่งเหมือนหน้าจอเครื่อง · F2 ค่าเป็นหลักพัน ไม่มีทศนิยม
  function formatTorque(value, partKey, extra = 0) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "–";
    const digits = (partKey === "F2" ? 0 : 2) + extra;
    return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function formatMetric(metric, value, partKey) {
    return metric.kind === "time" ? formatClock(value) : formatTorque(value, partKey);
  }
  // SD ของเวลาเป็นวินาที (ทศนิยม 1 ตำแหน่ง) เพราะ m:ss ปัดจนเห็นแต่ 0:00–0:05
  function formatSd(metric, value, partKey) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "–";
    return metric.kind === "time" ? `${value.toFixed(1)} วิ` : formatTorque(value, partKey, 1);
  }

  const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  // วันที่ไทยแบบย่อ (พ.ศ.) เหมือนหน้าอื่นของ LAB: 2026-11-02 → 2 พ.ย. 2569
  function formatDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
    if (!match) return String(iso ?? "");
    return `${Number(match[3])} ${THAI_MONTHS[Number(match[2]) - 1]} ${Number(match[1]) + 543}`;
  }

  /* ---------- URL ---------- */

  // #/lab?module=mdr&part=F1&formula=A2004&date=2026-11-02 — part ไม่ระบุ = F1
  function readRoute(params) {
    const part = findPart(params?.get?.("part"))?.key ?? "F1";
    const formula = String(params?.get?.("formula") ?? "").trim();
    const date = String(params?.get?.("date") ?? "").trim();
    return {
      part,
      formula: /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/.test(formula) ? formula : "",
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
    };
  }
  function routeUrl({ part = "F1", formula = "", date = "" } = {}) {
    const query = new URLSearchParams({ module: "mdr", part });
    if (formula) query.set("formula", formula);
    if (formula && date) query.set("date", date);
    return `#/lab?${query.toString()}`;
  }

  const api = {
    MAX_FILE_BYTES, MAX_POINTS, UPLOAD_BATCH, CURVE_SLACK_S, NO_SWELL_RISE, NO_SWELL_END_S, MIN_BAND_TESTS, PARTS, METRICS, SKIP, findPart,
    parseClock, splitName, cureFromCurve, parseIni, testKey, classifyFiles, groupSkipped, chunk,
    mean, sampleSd, metricValue, summarize, groupByDate, hasMetric, normalizeTests, noSwell, applyDisplayRules,
    conditionKey, conditionsOf, formatCondition,
    formatClock, formatTorque, formatMetric, formatSd, formatDate, readRoute, routeUrl,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_LAB_MDR = api;
})(typeof window !== "undefined" ? window : globalThis);
