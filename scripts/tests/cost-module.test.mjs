import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// ต้นทุนการผลิต: ราคาเคมีและของซื้อในรายการ ในคลัง ของ ST (#/st?tab=stock · modules/st-pages.js) และโมดูล #/cost (modules/cost-pages.js · module-cost.js · cost-data.js)
// ใครเห็นเมนูไหน · คอลัมน์ราคา/ตัวกรองราคา/หมวดในรายการ ในคลัง (ยังไม่มีราคารวมของยอด 0 · ปุ่มตามสิทธิ์เขียน) · dialog ราคา (ประวัติ · ส่ง app_rf_price_save) · หน้าต้นทุน (รายการ รายละเอียด เทียบกับจริง สถานะไม่มีสิทธิ์) · ไม่เก็บราคาลงเครื่อง
const FILES = [
  "vendor/qrcode-generator/qrcode.js", "modules/ui-icons.js", "modules/department-access.js",
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/factory-kit.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/bom-pages.js", "modules/bom-hub.js", "modules/module-bom.js",
  "modules/cost-rules.js", "modules/cost-data.js", "modules/cost-labour-ui.js",
  "modules/st-pages.js", "modules/module-st.js", "modules/module-sr.js", "modules/qa-pages.js", "modules/module-qa.js", "modules/gr-pages.js", "modules/dept-pages.js", "modules/module-gr.js", "modules/module-pt.js", "modules/module-bg.js", "modules/module-pk.js", "modules/wh-pages.js", "modules/module-wh.js", "modules/sa-pages.js", "modules/module-sa.js",
  "modules/cost-pages.js", "modules/module-cost.js",
];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const read = (file) => fs.readFileSync(file, "utf8");
const emp = (dept, role = "employee", extra = {}) => ({ department: { code: dept }, role: { code: role }, isSandbox: true, ...extra });
const h1Of = (html) => (html.match(/<h1>([^<]*)<\/h1>/) ?? [])[1] ?? "";
const tick = () => new Promise((resolve) => setImmediate(resolve));
const NOTE_XSS = "<img src=x onerror=alert(1)>";

const DAY = 86400000;
const w = (materialCode, stage, kg, unit = "kg") => ({ materialCode, stage, kg, unit, phr: 0 });
const DEMO = {
  id: "DEMO-W01", revision: 2, status: "approved", productCode: "FG-91", batchKg: 75.6,
  items: [
    w("DM-RUB-A", 0, 11), w("DM-RUB-B", 0, 4), w("DM-FIL-A", 0, 9), w("DM-FIL-B", 0, 14), w("DM-PLS-A", 0, 12), w("DM-OIL-A", 0, 6), w("DM-FIL-C", 0, 15),
    w("DM-CH-01", 1, 0.35, "g"), w("DM-CH-02", 1, 0.15, "g"), w("DM-CH-03", 1, 0.8, "g"), w("DM-CH-04", 1, 0.12, "g"), w("DM-CH-05", 1, 0.09, "g"), w("DM-CH-06", 1, 0, "g"), w("DM-CH-07", 1, 0, "g"),
    w("DM-CH-08", 2, 0.9), w("DM-CH-09", 2, 1.6), w("DM-CH-10", 2, 0.18), w("DM-CH-11", 3, 0.31), w("DM-CH-12", 3, 0.075), w("DM-CH-13", 3, 0.025),
  ],
};
const LEGACY = { id: "RC-OLD", revision: 1, status: "approved", productCode: "DS-1", batchKg: 60, items: [{ materialCode: "EPDM-55", phr: 100, stage: 1 }, { materialCode: "S-80", phr: 10, stage: 2 }] };
const CODES = [...new Set([...DEMO.items, ...LEGACY.items].map((item) => item.materialCode))];
const price = (materialCode, unitPrice, effectiveFrom = "2026-01-01", createdAt = 1, extra = {}) => ({ id: `p-${extra.kind ?? "chem"}-${materialCode}-${createdAt}`, kind: "chem", materialCode, unitPrice, effectiveFrom, note: "", createdAt, createdBy: "วิชัย", ...extra });
const PRICES = [
  ...CODES.filter((code) => !["DM-FIL-C", "DM-CH-05"].includes(code)).map((code) => price(code, 10)),
  price("ZNO", 62, "2026-01-01", 1), price("ZNO", 70, "2026-10-01", 2, { note: NOTE_XSS }),
  // ราคาของซื้อ (ต่อหน่วยของชิ้น): กล่อง = 4.50 ต่อกล่อง · ถุง = 12 ต่อ kg · ที่เหลือยังไม่มีราคา
  price("P-BOX-01", 4.5, "2026-01-01", 1, { kind: "part" }), price("P-BAG-01", 12, "2026-01-01", 1, { kind: "part" }),
];
const lotOf = (lotNo, createdAt, actualKg) => ({ lotNo, orderId: "WO-1", recipeId: "DEMO-W01", recipeRevision: 2, batches: 2, createdAt, requisitions: [{ id: "REQ-1", issuedAt: createdAt, lines: [{ materialCode: "DM-RUB-A", stage: 0, targetKg: 22, actualKg, weighedAt: createdAt }] }] });
const COST_DATA = {
  prices: PRICES,
  materials: CODES.map((code) => ({ code, name: `ชื่อ ${code}`, category: "เคมี" })),
  recipes: [DEMO, { ...DEMO, revision: 1, status: "superseded" }, LEGACY],
  lots: [lotOf("MX-100", Date.now() - DAY, 23), lotOf("MX-101", Date.now() - 2 * DAY, 21)],
};

// ค่าแรง (เฟส 2): อัตรา RB 60 บาท/ชม. · เวลามาตรฐานของสินค้า FG-91 = 441 นาทีคน (7.35 ชม.) ต่อชุดผสม → ค่าแรง 441.00 บาท · RC-OLD ไม่มีเวลามาตรฐาน
const STEP_IDS = ["prep", "mix1", "mix2", "mix3", "extrusion", "curing", "finishing"];
const stepsOf = (minutes, workers) => STEP_IDS.map((step, index) => ({ step, minutes: minutes[index], workers: workers[index] }));
const LABOUR = {
  rates: [{ id: "r1", departmentCode: "RB", ratePerHour: 60, effectiveFrom: "2026-01-01", note: "อัตราเปิด", createdAt: 1, createdBy: "ผู้ทดสอบ" }],
  standards: [{ id: "s1", productCode: "FG-91", effectiveFrom: "2026-01-01", steps: stepsOf([30, 12, 6, 0, 60, 45, 30], [2, 2, 2, 0, 3, 1, 4]), note: "", createdAt: 1, createdBy: "ผู้ทดสอบ" }],
};

// Supabase จำลอง: สิทธิ์ตามผู้ใช้ที่ทำหน้าที่อยู่ (ตรงกับ RPC จริง: เห็นต้นทุน = GM/FM/admin/PP · เห็นราคา = เห็นต้นทุน + ST · เขียน = ST/admin)
function fakeSb(getEmployee, log) {
  const roleOf = () => getEmployee()?.role?.code ?? "";
  const deptOf = () => String(getEmployee()?.department?.code ?? "").toUpperCase();
  const seeCost = () => ["general_manager", "factory_manager", "admin"].includes(roleOf()) || deptOf() === "PP";
  const seePrices = () => seeCost() || deptOf() === "ST";
  const write = () => deptOf() === "ST" || roleOf() === "admin";
  const refuse = () => ({ data: null, error: { message: "RF_FORBIDDEN" } });
  return {
    async rpc(name, args) {
      log.rpc.push([name, args]);
      if (name === "app_rf_prices") return seePrices() ? { data: { canWrite: write(), prices: log.prices }, error: null } : refuse();
      if (name === "app_rf_price_save") {
        if (!write()) return refuse();
        if (log.invalid) return { data: null, error: { message: "RF_INVALID_PRICE" } };
        log.prices = [...log.prices, price(args.p_material_code, args.p_unit_price, args.p_effective_from, 99, { kind: args.p_kind, note: args.p_note })];
        return { data: { canWrite: true, prices: log.prices }, error: null };
      }
      // ค่าแรง: อ่าน = ผู้เห็นต้นทุน + แผนก RB (RB ไม่ได้อัตรา) · แก้อัตรา = ผู้เห็นต้นทุน · แก้เวลามาตรฐาน = ผู้เห็นต้นทุน + หัวหน้าแผนก RB
      const rbHead = () => deptOf() === "RB" && ["department_manager", "assistant_department_manager"].includes(roleOf());
      const labourOut = () => ({ data: { canSeeRates: seeCost(), canWriteRates: seeCost(), canWriteStandards: seeCost() || rbHead(), rates: seeCost() ? log.labour.rates : [], standards: log.labour.standards }, error: null });
      if (name === "app_rf_labour") return seeCost() || deptOf() === "RB" ? labourOut() : refuse();
      if (name === "app_rf_labour_rate_save") {
        if (!seeCost()) return refuse();
        if (log.invalid) return { data: null, error: { message: "RF_INVALID_LABOUR" } };
        log.labour = { ...log.labour, rates: [...log.labour.rates, { id: "r-new", departmentCode: args.p_department_code, ratePerHour: args.p_rate_per_hour, effectiveFrom: args.p_effective_from, note: args.p_note, createdAt: 99, createdBy: "ผู้ทดสอบ" }] };
        return labourOut();
      }
      if (name === "app_rf_station_standard_save") {
        if (!(seeCost() || rbHead())) return refuse();
        if (log.invalid) return { data: null, error: { message: "RF_INVALID_STANDARD" } };
        log.labour = { ...log.labour, standards: [...log.labour.standards, { id: "s-new", productCode: args.p_product_code, effectiveFrom: args.p_effective_from, steps: args.p_steps, note: args.p_note, createdAt: 99, createdBy: "ผู้ทดสอบ" }] };
        return labourOut();
      }
      if (name === "app_rf_cost_data") return seeCost() ? { data: { ...COST_DATA, prices: log.prices }, error: null } : refuse();
      // หมวดของซื้อ: อ่าน = ผู้เห็นราคา · ตั้ง = ผู้บันทึกราคา (สิทธิ์ชุดเดียวกับราคา)
      if (name === "app_rf_part_categories") return seePrices() ? { data: { categories: log.categories, canWrite: write() }, error: null } : refuse();
      if (name === "app_rf_part_category_save") {
        if (!write()) return refuse();
        if (log.invalid) return { data: null, error: { message: "RF_INVALID_CATEGORY" } };
        log.categories = [...log.categories.filter((row) => row.itemCode !== args.p_item_code), ...(args.p_category ? [{ itemCode: args.p_item_code, category: args.p_category }] : [])];
        return { data: { categories: log.categories, canWrite: true }, error: null };
      }
      return { data: null, error: { message: "unknown rpc" } };
    },
  };
}

function load({ employee = emp("ST") } = {}) {
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { renders: 0, notFound: 0, hash: "#/st", toasts: [], rpc: [], prices: PRICES, labour: LABOUR, categories: [], invalid: false };
  const fakes = {};
  const node = () => ({
    handlers: {}, dataset: {}, value: "", disabled: false, textContent: "", innerHTML: "", tagName: "DIV", classList: { toggle() {}, add() {}, remove() {} }, files: [],
    addEventListener(type, handler) { this.handlers[type] = handler; }, querySelector: (selector) => fakes[selector]?.[0] ?? null, querySelectorAll: (selector) => fakes[selector] ?? [],
    focus() {}, dispatchEvent() {}, close() {}, remove() {}, showModal() {},
  });
  const generic = () => ({ ...node(), querySelector: () => generic(), querySelectorAll: () => [], addEventListener() {} });
  const root = node();
  const storage = new Map();
  const state = { employee };
  Object.assign(context, {
    window: context, addEventListener() {}, escapeHtml, showToast: (message, kind) => log.toasts.push([message, kind ?? "ok"]), friendlyError: (error) => String(error?.message ?? error),
    renderRoute: async () => { log.renders += 1; }, confirmDialog: async () => true, URLSearchParams, Intl, Date, structuredClone, setInterval: () => 0, setTimeout: () => 0, encodeURIComponent,
    location: { get hash() { return log.hash; }, set hash(value) { log.hash = value.startsWith("#") ? value : `#${value}`; } },
    app, state,
    shell: (content, path, title) => `<shell path="${path}" title="${escapeHtml(title)}">${content}</shell>`,
    bindShell() {}, loadingShell() {}, renderNotFound: () => { log.notFound += 1; app.innerHTML = "<notfound></notfound>"; },
    currentRoute: () => { const raw = log.hash.replace(/^#\/?/, ""); const [path, query = ""] = raw.split("?"); return { path, params: new URLSearchParams(query) }; },
    document: { querySelector: () => root, querySelectorAll: () => [], body: root, activeElement: null, createElement: () => generic(), addEventListener() {} },
    localStorage: { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    sessionStorage: { getItem: () => null, setItem: () => { throw new Error("ราคาห้ามเก็บลง sessionStorage"); }, removeItem() {} },
    FormData: class { constructor(form) { this.values = form?.__values ?? {}; } entries() { return Object.entries(this.values); } get(key) { return this.values[key] ?? null; } },
    MNP_REQUEST_MODULES: {}, TextDecoder, Uint8Array, DataView,
  });
  context.sb = fakeSb(() => context.state.employee, log);
  const setItem = context.localStorage.setItem;
  context.localStorage.setItem = (key, value) => { log.stored = [...(log.stored ?? []), `${key}=${value}`]; setItem(key, value); };
  for (const file of FILES) vm.runInContext(read(file), context, { filename: file });
  context.MNP_BOM.store.setUser("B08");
  context.MNP_RUBBERFLOW.store.setUser("U04");
  const modules = context.MNP_REQUEST_MODULES;
  const openSt = async (query = "") => {
    log.hash = `#/st${query ? `?${query}` : ""}`;
    app.innerHTML = "";
    await modules.FACTORY_ST.pages.st(new URLSearchParams(query));
    return app.innerHTML;
  };
  const openCost = async (query = "") => {
    log.hash = `#/cost${query ? `?${query}` : ""}`;
    app.innerHTML = "";
    await modules.FACTORY_COST.pages.cost(new URLSearchParams(query));
    return app.innerHTML;
  };
  const setEmployee = (next) => { context.state.employee = next; };
  return { context, app, log, fakes, modules, openSt, openCost, setEmployee };
}
const stMenu = (env) => {
  const item = env.modules.FACTORY_ST.nav[0];
  return [...item.subnav(item.path).matchAll(/<span class="rf-nav-text">([^<]*)<\/span>/g)].map((match) => match[1]);
};
const costMenu = (env, path = "cost") => [...env.modules.FACTORY_COST.nav[0].subnav(path).matchAll(/<span class="rf-nav-text">([^<]*)<\/span>/g)].map((match) => match[1]);
// ให้หน้าที่ขอโหลดข้อมูลโหลดเสร็จก่อนวาดอีกครั้ง
const settled = async (open, query) => { await open(query); await tick(); await tick(); return open(query); };

// แถวของตาราง (หน้า ในคลัง) เป็นข้อความต่อแถว
const bodyRows = (html) => ((html.match(/<tbody>([\s\S]*?)<\/tbody>/) ?? [])[1] ?? "").split("<tr").slice(1);
const priceCalls = (env) => env.log.rpc.filter(([name]) => name === "app_rf_prices").length;
// ของที่ใช้งานอยู่แต่ไม่มียอดในคลัง ST (ไม่มีล็อต / ไม่มียอดซื้อเข้า) ใส่เข้าข้อมูลสาธิตเพื่อทดสอบตัวกรอง "ยังไม่มีราคา"
function addEmptyItems(env) {
  env.context.MNP_RUBBERFLOW.store.data().materials.push({ code: "ZZ-NEW", name: "เคมีใหม่ยังไม่รับเข้า", category: "สารเคมี", active: true }, { code: "ZZ-OLD", name: "เคมีเลิกใช้", category: "สารเคมี", active: false });
  env.context.MNP_BOM.store.data().items.push({ code: "P-ZERO-01", kind: "PURCHASED", name: "ของซื้อยังไม่รับเข้า", uom: "pcs", active: true }, { code: "P-ZERO-OFF", kind: "PURCHASED", name: "ของซื้อเลิกใช้", uom: "pcs", active: false });
}

test("menu: ราคาไม่มีเมนูแยกใน ST แล้ว · เมนูต้นทุนการผลิตเฉพาะผู้ที่เห็นต้นทุน", async () => {
  const cases = [
    // [ผู้ใช้, เมนูต้นทุน]
    [emp("ST"), false], [emp("ST", "department_manager"), false], [emp("PP"), true], [emp("AD", "admin"), true],
    [emp("OFFICE", "general_manager"), true], [emp("OFFICE", "factory_manager"), true], [emp("OFFICE", "assistant_factory_manager"), false],
  ];
  for (const [employee, cost] of cases) {
    const env = load({ employee });
    await env.openSt();
    assert.equal(stMenu(env).some((label) => label.includes("ราคา")), false, `ST menu has no price entry · ${JSON.stringify(employee)}`);
    assert.deepEqual(stMenu(env).slice(0, 2).map((label) => label.replace(/\s*\d+$/, "")), ["งานของฉัน", "ในคลัง"]);
    assert.equal(env.modules.FACTORY_COST.navAllowed(employee), cost, `cost menu · ${JSON.stringify(employee)}`);
  }
  for (const employee of [emp("RB"), emp("RB", "department_manager"), emp("WH"), emp("PU"), emp("QA", "department_manager"), emp("SA"), { ...emp("PP"), isSandbox: false }, { ...emp("AD", "admin"), isSandbox: false }]) {
    const env = load({ employee });
    assert.equal(env.modules.FACTORY_COST.navAllowed(employee), false, `no cost menu · ${JSON.stringify(employee)}`);
  }
});

test("module: อยู่ในกลุ่มโรงงาน โหมดทดสอบเท่านั้น ท้ายกลุ่ม · เมนูข้าง ต้นทุนสูตร / สูตรเทียบจริง", async () => {
  const env = load({ employee: emp("PP") });
  const entry = env.modules.FACTORY_COST;
  assert.equal(entry.sandbox, true);
  assert.equal(entry.standalone, true);
  assert.equal(entry.nav[0].group, "โรงงาน");
  assert.equal(entry.nav[0].sandboxOnly, true);
  assert.equal(entry.nav[0].path, "cost");
  assert.equal(entry.nav[0].label, "ต้นทุนการผลิต");
  const ordered = env.context.MNP_FACTORY.orderNavItems(Object.values(env.modules).filter((module) => module.navAllowed?.(emp("PP"))).flatMap((module) => module.nav ?? []));
  const group = ordered.filter((item) => item.group === "โรงงาน");
  assert.equal(group.at(-1).path, "cost", "ท้ายกลุ่มโรงงาน");
  assert.deepEqual(costMenu(env), ["ต้นทุนสูตร", "สูตรเทียบจริง", "ต้นทุนต่อชิ้น"]);
  assert.equal(entry.nav[0].subnav("st"), "", "เมนูข้างโผล่เฉพาะตอนเปิดโมดูลนี้");
});

test("ST ในคลัง: ผู้ที่เห็นราคาได้คอลัมน์ราคา/หน่วย ทั้งเคมีและของซื้อ · ปุ่มอยู่แถวแรกของแต่ละตัว · โหลดครั้งเดียว · ไม่เก็บลงเครื่อง", async () => {
  const env = load({ employee: emp("ST") });
  const first = await env.openSt("tab=stock");
  assert.equal(h1Of(first), "ในคลัง");
  assert.match(first, /กำลังโหลดราคา/);
  await tick();
  assert.ok(env.log.renders >= 1, "วาดหน้าใหม่เมื่อโหลดเสร็จ");
  const html = await env.openSt("tab=stock");
  assert.match(html, /<th[^>]*>ราคา\/หน่วย \(บาท\)<\/th>/);
  assert.doesNotMatch(html, /กำลังโหลดราคา/);
  const rows = bodyRows(html);
  // เคมี: EPDM-55 มีราคา 10 ต่อ kg · ล็อตของวัตถุดิบเดียวกันอยู่ติดกัน ราคาและปุ่มอยู่แถวแรกเท่านั้น แถวถัดไปช่องราคาว่าง (ไม่ซ้ำราคาทุกล็อต)
  const epdm = rows.filter((row) => row.includes(">EPDM-55<"));
  assert.ok(epdm.length >= 2, "เคมีตัวเดียวกันหลายล็อต");
  assert.match(epdm[0], /10\.00<\/span> <span class="small muted">\/kg/, "ราคาอยู่แถวแรกของวัตถุดิบ");
  assert.ok(epdm.slice(1).every((row) => row.includes('<td class="right"></td>') && !/\/kg<\/span>|costPrice|ยังไม่มีราคา/.test(row)), "แถวถัดไปของวัตถุดิบเดียวกันเว้นช่องราคา");
  assert.equal(epdm.filter((row) => row.includes("data-rf-open=\"costPrice\"")).length, 1, "ปุ่มเดียวต่อวัตถุดิบ");
  assert.match(epdm[0], /data-rf-args="\{&quot;kind&quot;:&quot;chem&quot;,&quot;code&quot;:&quot;EPDM-55&quot;\}"[^>]*>ราคาใหม่</);
  // แถวแรกตามรายการที่แสดง: ค้นหาล็อตที่สองของ EPDM-55 แถวนั้นได้ราคาและปุ่ม
  const secondLot = (epdm[1].match(/href="#\/st\?lot=([^"]+)"/) ?? [])[1];
  assert.ok(secondLot);
  const searched = bodyRows(await env.openSt(`tab=stock&q=${secondLot}`));
  assert.equal(searched.length, 1);
  assert.match(searched[0], /10\.00<\/span> <span class="small muted">\/kg[\s\S]*data-rf-open="costPrice"/);
  // เคมีที่ยังไม่มีราคา = ป้าย + ปุ่มตั้งราคา
  const unpriced = rows.find((row) => row.includes(">AO-6PPD<"));
  assert.match(unpriced, /ยังไม่มีราคา[\s\S]*data-rf-open="costPrice"[\s\S]*>ตั้งราคา</);
  // ของซื้อ: ราคาต่อหน่วยของชิ้นนั้น (กล่อง / กก.) · ที่ยังไม่มีราคามีป้าย
  const box = rows.find((row) => row.includes("P-BOX-01"));
  assert.match(box, /4\.50<\/span> <span class="small muted">\/กล่อง/);
  assert.match(box, /&quot;kind&quot;:&quot;part&quot;/);
  assert.match(rows.find((row) => row.includes("P-STK-01")), /ยังไม่มีราคา/);
  assert.equal(priceCalls(env), 1, "โหลดครั้งเดียว");
  assert.ok(!(env.log.stored ?? []).some((entry) => /unitPrice|pricePerKg|effectiveFrom/.test(entry)), "ไม่มีราคาถูกเขียนลง localStorage");
  assert.doesNotMatch(html, /undefined|NaN/);
  // ค่าตั้งต้นยังเป็นเฉพาะของที่มียอด: ไม่มีของยอด 0 (ไม่มีตัวที่ใช้งานอยู่แต่ไม่มียอดเข้ามาปน)
  const withEmpty = load({ employee: emp("ST") });
  addEmptyItems(withEmpty);
  const plain = await settled(withEmpty.openSt, "tab=stock");
  assert.doesNotMatch(plain, /ZZ-NEW|P-ZERO-01/, "ค่าตั้งต้นไม่แสดงของที่ไม่มียอด");
});

test("ST ในคลัง: ตัวกรอง ยังไม่มีราคา แสดงทุกเคมี/ของซื้อที่ใช้งานอยู่ที่ไม่มีราคา รวมที่ยอด 0 · ค้นหาได้ · มีราคาแล้วเฉพาะที่มียอด", async () => {
  const env = load({ employee: emp("ST") });
  addEmptyItems(env);
  const missing = await settled(env.openSt, "tab=stock&price=missing");
  const rows = bodyRows(missing);
  assert.ok(rows.length > 0 && rows.every((row) => row.includes("ยังไม่มีราคา") || row.includes('<td class="right"></td>')), "ทุกแถวยังไม่มีราคา (ล็อตถัดไปของเคมีตัวเดียวกันเว้นช่องราคา)");
  const zeroChem = rows.find((row) => row.includes(">ZZ-NEW<"));
  assert.match(zeroChem, /0 kg/);
  assert.match(zeroChem, /data-rf-open="costPrice"[\s\S]*>ตั้งราคา</, "ตั้งราคาให้เคมีที่ยังไม่เคยรับเข้าได้");
  assert.doesNotMatch(zeroChem, /href="#\/st\?lot=/, "ไม่มีล็อต");
  const zeroPart = rows.find((row) => row.includes("P-ZERO-01"));
  assert.match(zeroPart, /0 ชิ้น/);
  assert.match(zeroPart, /&quot;kind&quot;:&quot;part&quot;/);
  assert.doesNotMatch(missing, /ZZ-OLD|P-ZERO-OFF/, "ที่เลิกใช้แล้วไม่ขึ้น");
  assert.ok(!rows.some((row) => row.includes(">EPDM-55<")), "ที่มีราคาแล้วไม่ขึ้น");
  assert.doesNotMatch(missing, /ยังไม่มีราคา \(\d+\)/, "ตัวเลือกไม่มีจำนวน (จำนวนรวมไม่ตรงกับรายการหลังกรองชนิด / หมวด)");
  // ค้นหารหัส / ชื่อ ในตัวกรองนี้
  assert.match(await env.openSt("tab=stock&price=missing&q=ZZ-NEW"), /ZZ-NEW/);
  const byName = await env.openSt("tab=stock&price=missing&q=ยังไม่รับเข้า");
  assert.match(byName, /ZZ-NEW/);
  assert.match(byName, /P-ZERO-01/);
  assert.doesNotMatch(byName, /AO-6PPD/);
  // มีราคาแล้ว = เฉพาะของที่มียอดและมีราคา
  const priced = bodyRows(await env.openSt("tab=stock&price=priced"));
  assert.ok(priced.length > 0 && priced.every((row) => !row.includes("ยังไม่มีราคา")));
  assert.ok(priced.some((row) => row.includes(">EPDM-55<")) && priced.some((row) => row.includes("P-BOX-01")));
  assert.ok(!priced.some((row) => row.includes("ZZ-NEW")));
  // ตัวเลือกกรองแสดงครบ และลิงก์เก่าที่ไม่ใช่ค่าที่รู้จักถูกมองข้าม
  assert.match(missing, /<select[^>]*name="price"[\s\S]*?<\/select>/);
  assert.ok(bodyRows(await env.openSt("tab=stock&price=nonsense")).length > 0);
});

test("ST ในคลัง: ตัวกรองหมวด (เคมีตามหมวดวัตถุดิบ · ของซื้อ = ของซื้อ) และตัวกรองชนิดทำงานร่วมกัน", async () => {
  const env = load({ employee: emp("ST") });
  const html = await settled(env.openSt, "tab=stock");
  const options = [...html.match(/<select[^>]*name="cat"[\s\S]*?<\/select>/)[0].matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]);
  for (const category of ["ของซื้อ", "สารตัวเติม", "โพลิเมอร์", "สารกันเสื่อม"]) assert.ok(options.includes(category), category);
  assert.equal(new Set(options).size, options.length, "ไม่ซ้ำ");
  const filler = bodyRows(await env.openSt("tab=stock&cat=สารตัวเติม"));
  assert.ok(filler.length > 0 && filler.every((row) => row.includes("รหัส") === false) && filler.some((row) => row.includes("CACO3")));
  assert.ok(!filler.some((row) => row.includes("AO-6PPD")), "หมวดอื่นไม่ขึ้น");
  assert.ok(!filler.some((row) => row.includes("P-BOX-01")));
  const parts = bodyRows(await env.openSt("tab=stock&cat=ของซื้อ"));
  assert.ok(parts.length === 7 && parts.every((row) => row.includes("?part=")), "ของซื้อทั้งหมด");
  // ชนิด + หมวด
  const chemFiller = bodyRows(await env.openSt("tab=stock&kind=chem&cat=สารตัวเติม"));
  assert.ok(chemFiller.length > 0 && chemFiller.every((row) => !row.includes("?part=") && !row.includes("AO-6PPD")));
  assert.ok(bodyRows(await env.openSt("tab=stock&kind=part&cat=สารตัวเติม")).every((row) => row.includes("?part=")), "หมวดที่ไม่มีในชนิดที่เลือกถูกมองข้าม");
  // หมวดที่ไม่มีอยู่จริงถูกมองข้าม
  assert.ok(bodyRows(await env.openSt("tab=stock&cat=ไม่มีหมวดนี้")).length > 20);
  // หมวดนำไปกับลิงก์ล้างตัวกรองและตัวกรองใน URL (cat · price อยู่ใน KEEP)
  assert.deepEqual([...env.context.MNP_ST_PAGES.KEEP].filter((key) => ["kind", "cat", "price"].includes(key)).sort(), ["cat", "kind", "price"]);
  // ตัวกรองชนิด/หมวด/ราคาเปลี่ยนแล้วไปหน้าในคลังพร้อมตัวกรอง (แม้เปิดจากลิงก์เก่า ?tab=prices)
  const select = { name: "cat", value: "ของซื้อ", handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  env.fakes["[data-st-filter]"] = [select];
  await env.openSt("tab=prices");
  select.handlers.change();
  assert.equal(env.log.hash, "#/st?cat=%E0%B8%82%E0%B8%AD%E0%B8%87%E0%B8%8B%E0%B8%B7%E0%B9%89%E0%B8%AD&tab=stock");
  delete env.fakes["[data-st-filter]"];
});

test("ST ในคลัง: ผู้อ่านอย่างเดียว (ผู้จัดการ / PP) เห็นราคา ปุ่มประวัติราคาเฉพาะที่เคยมีราคา · ไม่มีปุ่มตั้งราคา · admin ตั้งราคาได้", async () => {
  for (const employee of [emp("PP"), emp("OFFICE", "general_manager"), emp("OFFICE", "factory_manager")]) {
    const env = load({ employee });
    const html = await settled(env.openSt, "tab=stock");
    assert.match(html, /<th[^>]*>ราคา\/หน่วย \(บาท\)<\/th>/, JSON.stringify(employee));
    assert.match(html, /data-rf-open="costPrice"[^>]*>ประวัติราคา</, JSON.stringify(employee));
    assert.doesNotMatch(html, />ตั้งราคา<|>ราคาใหม่</, `ผู้อ่านไม่มีปุ่มตั้งราคา ${JSON.stringify(employee)}`);
    const unpriced = bodyRows(html).find((row) => row.includes(">AO-6PPD<"));
    assert.match(unpriced, /ยังไม่มีราคา/);
    assert.doesNotMatch(unpriced, /data-rf-open="costPrice"/, "ไม่เคยมีราคา = ไม่มีประวัติให้ดู");
    assert.match(html, /name="price"/, "ผู้อ่านใช้ตัวกรองราคาได้");
  }
  const admin = load({ employee: emp("AD", "admin") });
  assert.match(await settled(admin.openSt, "tab=stock"), />ตั้งราคา<|>ราคาใหม่</, "admin ตั้งราคาได้");
});

test("ST ในคลัง: ผู้ที่ไม่เห็นราคาและผู้เข้าชม (RB / WH) ไม่มีคอลัมน์ ตัวกรอง ปุ่ม และไม่เรียก RPC ราคา · ?tab=prices กลับมาที่ในคลัง", async () => {
  // ผู้ช่วยผู้จัดการโรงงานเปิดโมดูล ST ได้แต่ไม่เห็นราคา
  const afm = load({ employee: emp("OFFICE", "assistant_factory_manager") });
  for (const query of ["tab=stock", "tab=stock&price=missing", "tab=prices&price=missing", "lot=RM-AO-6PPD-20261024-01", "part=P-BOX-01"]) {
    const html = await settled(afm.openSt, query);
    assert.doesNotMatch(html, /ราคา\/หน่วย|ราคา\/kg|ราคา\/กล่อง|name="price"|costPrice|ตั้งราคา|ยังไม่มีราคา|กำลังโหลดราคา/, `afm ${query}`);
  }
  assert.equal(h1Of(await afm.openSt("tab=prices")), "ในคลัง");
  assert.equal(afm.log.rpc.length, 0, "ไม่เรียกราคา");
  assert.match(await afm.openSt("tab=stock"), /name="cat"/, "หมวดเห็นได้ทุกคนที่ดูในคลัง");
  // RB / WH: หน้าในคลังของผู้เข้าชม · ไม่มีราคา แม้พิมพ์ตัวกรองราคาเอง
  for (const dept of ["RB", "WH"]) {
    const env = load({ employee: emp(dept) });
    for (const query of ["tab=prices", "tab=stock&price=missing", "tab=stock&cat=ของซื้อ"]) {
      const html = await env.openSt(query);
      assert.equal(h1Of(html), "ในคลัง", `${dept} ${query}`);
      assert.doesNotMatch(html, /ราคา|costPrice|name="price"|name="cat"/, `${dept} ${query}`);
    }
    assert.equal(env.log.rpc.length, 0);
  }
  // ผู้ที่ไม่ใช่ผู้เข้าชมและไม่เห็นราคา ไม่มี dialog ราคา
  for (const employee of [emp("OFFICE", "assistant_factory_manager"), emp("RB")]) {
    const env = load({ employee });
    assert.equal(env.context.MNP_BOM_DIALOGS.costPrice({ ...env.context.MNP_BOM.context(new URLSearchParams()), guest: null }, { kind: "chem", code: "ZNO" }), null);
  }
});

test("ST ในคลัง: ฐานข้อมูลปฏิเสธ (RF_FORBIDDEN) = ไม่มีส่วนราคา · โหลดไม่สำเร็จ = ข้อความและลองอีกครั้ง โดยรายการคลังยังใช้งานได้", async () => {
  const env = load({ employee: emp("ST") });
  env.context.sb = { rpc: async () => ({ data: null, error: { message: "RF_FORBIDDEN" } }) };
  const denied = await settled(env.openSt, "tab=stock");
  assert.doesNotMatch(denied, /ราคา\/หน่วย|name="price"|ตั้งราคา/);
  assert.ok(bodyRows(denied).length > 0, "รายการคลังยังแสดง");
  const broken = load({ employee: emp("ST") });
  broken.context.sb = { rpc: async () => ({ data: null, error: { message: "network down" } }) };
  const html = await settled(broken.openSt, "tab=stock");
  assert.match(html, /data-cost-retry/);
  assert.doesNotMatch(html, /network down/, "ไม่เปิดเผยข้อความภายใน");
  assert.doesNotMatch(html, /<th[^>]*>ราคา\/หน่วย/);
  assert.ok(bodyRows(html).length > 0, "รายการคลังยังแสดง");
  const retry = { disabled: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  broken.fakes["[data-cost-retry]"] = [retry];
  await broken.openSt("tab=stock");
  retry.handlers.click();
  assert.equal(retry.disabled, true);
});

test("ST หน้าล็อตเคมีและหน้าของซื้อ: ผู้ที่เห็นราคาเห็นราคาที่มีผลและปุ่ม · คนอื่นไม่เห็น", async () => {
  const lot = "lot=RM-EPDM-55-20261024-01";
  const env = load({ employee: emp("ST") });
  const lotNo = [...(await settled(env.openSt, "tab=stock")).matchAll(/href="#\/st\?lot=([^"]+)"/g)].map((match) => match[1]).find((value) => value.includes("EPDM-55"));
  assert.ok(lotNo, lot);
  const lotPage = await env.openSt(`lot=${lotNo}`);
  assert.match(lotPage, /ราคา\/kg[\s\S]*10\.00[\s\S]*data-rf-open="costPrice"[^>]*>ราคาใหม่</);
  assert.match(lotPage, /หมวด[\s\S]*โพลิเมอร์/);
  const partPage = await env.openSt("part=P-BOX-01");
  assert.match(partPage, /ราคา\/กล่อง[\s\S]*4\.50[\s\S]*data-rf-open="costPrice"[^>]*>ราคาใหม่</);
  assert.match(await env.openSt("part=P-STK-01"), /ยังไม่มีราคา[\s\S]*>ตั้งราคา</);
  // ผู้อ่านอย่างเดียว: ราคาและประวัติ ไม่มีปุ่มตั้งราคา
  const reader = load({ employee: emp("PP") });
  await settled(reader.openSt, "tab=stock");
  const readerPart = await reader.openSt("part=P-BOX-01");
  assert.match(readerPart, /4\.50/);
  assert.match(readerPart, />ประวัติราคา</);
  assert.doesNotMatch(readerPart, />ราคาใหม่<|>ตั้งราคา</);
  // ไม่เห็นราคา: ไม่มีแถวราคา ไม่เรียก RPC
  const afm = load({ employee: emp("OFFICE", "assistant_factory_manager") });
  assert.doesNotMatch(await afm.openSt(`lot=${lotNo}`), /ราคา|costPrice/);
  assert.doesNotMatch(await afm.openSt("part=P-BOX-01"), /ราคา|costPrice/);
  const rb = load({ employee: emp("RB") });
  assert.doesNotMatch(await rb.openSt(`lot=${lotNo}`), /ราคา|costPrice/);
  assert.equal(afm.log.rpc.length + rb.log.rpc.length, 0);
});

test("dialog ราคา: เคมีและของซื้อ · ประวัติทุกแถวของชนิดนั้น (ใช้อยู่ · ล่วงหน้า) · ฟอร์มเฉพาะผู้เขียน · หมายเหตุจากข้อมูลถูก escape", async () => {
  const env = load({ employee: emp("ST") });
  env.log.prices = [...PRICES, price("ZNO", 90, "2999-01-01", 3, { note: "ราคาล่วงหน้า" }), price("ZNO", 7, "2026-01-01", 4, { kind: "part", note: "ของซื้อรหัสซ้ำเคมี" })];
  await settled(env.openSt, "tab=stock");
  const base = env.context.MNP_BOM.context(new URLSearchParams());
  const built = env.context.MNP_BOM_DIALOGS.costPrice({ ...base, guest: null }, { kind: "chem", code: "ZNO" });
  assert.match(built.html, /ราคาเคมี · ZNO/);
  assert.match(built.html, /<form novalidate id="st-price-form" data-cost-price>/);
  assert.match(built.html, /ราคา \(บาท\/kg\)/);
  assert.match(built.html, /name="unitPrice"/);
  assert.match(built.html, /name="effectiveFrom"/);
  assert.match(built.html, /ใช้อยู่/);
  assert.match(built.html, /ยังไม่ถึงวันมีผล/);
  assert.match(built.html, /ราคาล่วงหน้า/);
  assert.doesNotMatch(built.html, /<img src=x/, "escaped");
  assert.match(built.html, /&lt;img src=x/);
  assert.equal((built.html.match(/<tbody>[\s\S]*<\/tbody>/)[0].match(/<tr>/g) ?? []).length, 3, "ทุกแถวของเคมีที่เคยบันทึก ไม่รวมของซื้อที่รหัสซ้ำ");
  assert.doesNotMatch(built.html, /ของซื้อรหัสซ้ำเคมี/);
  // ของซื้อ: ชื่อและหน่วยของชิ้น · ประวัติของชนิด part เท่านั้น
  const unit = base.rules.uomLabel("box");
  const part = env.context.MNP_BOM_DIALOGS.costPrice({ ...base, guest: null }, { kind: "part", code: "P-BOX-01" });
  assert.match(part.html, /ราคาของซื้อ · P-BOX-01/);
  assert.ok(part.html.includes(`ราคา (บาท/${unit})`));
  assert.match(part.html, /กล่องนอก/);
  assert.match(part.html, /4\.50/);
  assert.equal((part.html.match(/<tbody>[\s\S]*<\/tbody>/)[0].match(/<tr>/g) ?? []).length, 1);
  // รหัสที่ไม่ใช่ของซื้อ / ชนิดที่ไม่รู้จัก = ไม่มี dialog
  assert.equal(env.context.MNP_BOM_DIALOGS.costPrice({ ...base, guest: null }, { kind: "part", code: "ZNO" }), null);
  assert.equal(env.context.MNP_BOM_DIALOGS.costPrice({ ...base, guest: null }, { kind: "other", code: "ZNO" }), null);
  // ผู้อ่านอย่างเดียว
  const reader = load({ employee: emp("PP") });
  await settled(reader.openSt, "tab=stock");
  const readOnly = reader.context.MNP_BOM_DIALOGS.costPrice({ ...reader.context.MNP_BOM.context(new URLSearchParams()), guest: null }, { kind: "chem", code: "ZNO" });
  assert.doesNotMatch(readOnly.html, /st-price-form|name="unitPrice"/);
  assert.match(readOnly.html, /ปิด/);
  // ผู้ที่ไม่เห็นราคา / ผู้เข้าชม: ไม่มี dialog
  const none = load({ employee: emp("RB") });
  assert.equal(none.context.MNP_BOM_DIALOGS.costPrice({ ...none.context.MNP_BOM.context(new URLSearchParams()), guest: "rb" }, { kind: "chem", code: "ZNO" }), null);
});

test("dialog ราคา: ส่ง app_rf_price_save พร้อมชนิดและราคาต่อหน่วย · ผิดกติกา/ถูกปฏิเสธไม่ปิด dialog · สำเร็จวาดหน้าใหม่", async () => {
  const env = load({ employee: emp("ST") });
  await settled(env.openSt, "tab=stock");
  const base = env.context.MNP_BOM.context(new URLSearchParams());
  const open = (args) => {
    const built = env.context.MNP_BOM_DIALOGS.costPrice({ ...base, guest: null }, args);
    const field = (value) => ({ value });
    const form = { elements: { unitPrice: field("125.5"), effectiveFrom: field("2026-01-02"), note: field("  ใบเสนอราคา 15  ") }, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
    const buttons = [{ disabled: false }, { disabled: false }];
    const dialog = { querySelector: (selector) => (selector === "form[data-cost-price]" ? form : null), querySelectorAll: () => buttons, closed: false, close() { this.closed = true; } };
    built.bind(dialog);
    return { form, buttons, dialog, submit: () => form.handlers.submit({ preventDefault() {} }) };
  };
  const chem = open({ kind: "chem", code: "TMTD" });
  // ทศนิยมเกิน 4 ตำแหน่ง / ศูนย์ / มากเกินไป = ไม่ส่ง
  for (const bad of ["1.23456", "0", "-5", "10000001", "abc", ""]) {
    chem.form.elements.unitPrice.value = bad;
    await chem.submit();
  }
  assert.equal(env.log.rpc.filter(([name]) => name === "app_rf_price_save").length, 0, "ราคาที่ผิดไม่ถูกส่ง");
  assert.equal(env.log.toasts.length >= 5, true);
  // ฐานข้อมูลปฏิเสธ
  env.log.toasts.length = 0;
  chem.form.elements.unitPrice.value = "125.5";
  env.log.invalid = true;
  await chem.submit();
  assert.equal(chem.dialog.closed, false);
  assert.ok(chem.buttons.every((button) => button.disabled === false), "ปุ่มกลับมากดได้");
  assert.equal(env.log.toasts.at(-1)[1], "error");
  // สำเร็จ (เคมี)
  env.log.invalid = false;
  env.log.toasts.length = 0;
  const renders = env.log.renders;
  await chem.submit();
  const saved = env.log.rpc.filter(([name]) => name === "app_rf_price_save").at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(saved[1])), { p_kind: "chem", p_material_code: "TMTD", p_unit_price: 125.5, p_effective_from: "2026-01-02", p_note: "ใบเสนอราคา 15" });
  assert.equal(chem.dialog.closed, true);
  assert.deepEqual(env.log.toasts.at(-1), ["บันทึกราคา TMTD แล้ว", "ok"]);
  assert.ok(env.log.renders > renders, "วาดหน้าใหม่");
  assert.match(await env.openSt("tab=stock&q=TMTD"), /125\.50/, "ราคาใหม่ขึ้นในรายการ");
  // สำเร็จ (ของซื้อ): ส่ง kind part และราคาเป็นของซื้อ ไม่ปนกับเคมี
  const part = open({ kind: "part", code: "P-STK-01" });
  part.form.elements.unitPrice.value = "0.75";
  await part.submit();
  const savedPart = env.log.rpc.filter(([name]) => name === "app_rf_price_save").at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(savedPart[1])), { p_kind: "part", p_material_code: "P-STK-01", p_unit_price: 0.75, p_effective_from: "2026-01-02", p_note: "ใบเสนอราคา 15" });
  assert.equal(part.dialog.closed, true);
  const after = bodyRows(await env.openSt("tab=stock&q=P-STK-01"));
  assert.match(after[0], /0\.75<\/span> <span class="small muted">\/ชิ้น/);
});

test("หมวดของซื้อ: โหลดครั้งเดียวในหน่วยความจำ · ของซื้อที่มีหมวดอยู่ใต้หมวดนั้น (ตัวกรอง ?cat=) ที่เหลืออยู่ใต้ ของซื้อ · หมวดแสดงครั้งเดียวต่อแถว · ตั้งหมวดใน dialog ราคาของของซื้อ", async () => {
  const env = load({ employee: emp("ST") });
  env.log.categories = [{ itemCode: "P-BOX-01", category: "หีบห่อทดสอบ" }, { itemCode: "P-BAG-01", category: "หีบห่อทดสอบ" }];
  const D = env.context.MNP_COST_DATA;
  assert.equal(D.partCategories().status, "idle");
  const html = await settled(env.openSt, "tab=stock");
  assert.deepEqual([D.partCategories().status, D.partCategories().canWrite, D.partCategories().categories.length], ["ready", true, 2]);
  assert.equal(env.log.rpc.filter(([name]) => name === "app_rf_part_categories").length, 1, "loaded once");
  assert.ok(!(env.log.stored ?? []).some((entry) => entry.includes("หีบห่อทดสอบ")), "not stored on the device");
  const options = [...html.match(/<select[^>]*name="cat"[\s\S]*?<\/select>/)[0].matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]);
  assert.ok(options.includes("หีบห่อทดสอบ") && options.includes("ของซื้อ"));
  // หมวดอยู่ใต้ชื่อครั้งเดียว · ของซื้อที่ไม่มีหมวดไม่บอก "ของซื้อ" ซ้ำ
  const box = bodyRows(html).find((row) => row.includes("P-BOX-01"));
  assert.equal((box.match(/หีบห่อทดสอบ/g) ?? []).length, 1);
  assert.doesNotMatch(bodyRows(html).find((row) => row.includes("P-STK-01")), /หีบห่อทดสอบ|· ของซื้อ/);
  // ตัวกรองหมวด: เฉพาะสองชิ้น (ไม่ซ้ำหมวดในแถวเมื่อกรองอยู่) · ของซื้อ = ชิ้นที่ไม่มีหมวด
  const packed = bodyRows(await env.openSt("tab=stock&cat=หีบห่อทดสอบ"));
  assert.deepEqual(packed.map((row) => row.match(/\?part=([^"]+)"/)[1]).sort(), ["P-BAG-01", "P-BOX-01"]);
  assert.ok(packed.every((row) => !row.includes("หีบห่อทดสอบ")));
  const rest = bodyRows(await env.openSt("tab=stock&cat=ของซื้อ"));
  assert.ok(rest.length === 5 && rest.every((row) => row.includes("?part=") && !row.includes("P-BOX-01") && !row.includes("P-BAG-01")));
  assert.match(await env.openSt("part=P-BOX-01"), /หมวด[\s\S]*หีบห่อทดสอบ/, "the part page shows its category");
  assert.doesNotMatch(await env.openSt("part=P-STK-01"), /หีบห่อทดสอบ|>หมวด</);
  // dialog ราคาของของซื้อ (ผู้ตั้งหมวด): ช่องหมวด + ตัวเลือกหมวดที่ใช้อยู่ + ปุ่มบันทึกของตัวเอง · dialog ราคาเคมีไม่มี
  const base = env.context.MNP_BOM.context(new URLSearchParams());
  const built = env.context.MNP_BOM_DIALOGS.costPrice({ ...base, guest: null }, { kind: "part", code: "P-STK-01" });
  assert.match(built.html, /<form novalidate class="rf-row st-category-form" data-cost-category>/);
  assert.ok(built.html.includes('list="st-part-categories"') && built.html.includes('maxlength="40"'));
  assert.match(built.html, /<datalist id="st-part-categories"><option value="หีบห่อทดสอบ"><\/option><\/datalist>/);
  assert.match(built.html, /<button class="btn rf-btn secondary small" type="submit">บันทึกหมวด<\/button>/);
  assert.match(env.context.MNP_BOM_DIALOGS.costPrice({ ...base, guest: null }, { kind: "part", code: "P-BOX-01" }).html, /name="category"[^>]*value="หีบห่อทดสอบ"/);
  assert.doesNotMatch(env.context.MNP_BOM_DIALOGS.costPrice({ ...base, guest: null }, { kind: "chem", code: "ZNO" }).html, /data-cost-category|name="category"/);
  // บันทึก: ตัดช่องว่าง · ยาวเกิน 40 ไม่ส่ง · ฐานข้อมูลปฏิเสธไม่ปิด dialog · สำเร็จปิดและวาดหน้าใหม่ · ว่าง = ล้างหมวด
  const open = (code, value) => {
    const form = { elements: { category: { value } }, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
    const buttons = [{ disabled: false }];
    const dialog = { querySelector: (selector) => (selector === "form[data-cost-category]" ? form : null), querySelectorAll: () => buttons, closed: false, close() { this.closed = true; } };
    env.context.MNP_BOM_DIALOGS.costPrice({ ...base, guest: null }, { kind: "part", code }).bind(dialog);
    return { form, buttons, dialog, submit: () => form.handlers.submit({ preventDefault() {} }) };
  };
  const saves = () => env.log.rpc.filter(([name]) => name === "app_rf_part_category_save");
  const long = open("P-STK-01", "ก".repeat(41));
  await long.submit();
  assert.equal(saves().length, 0, "too long is not sent");
  assert.equal(env.log.toasts.at(-1)[1], "error");
  env.log.invalid = true;
  const refused = open("P-STK-01", "ฉลาก");
  await refused.submit();
  assert.equal(refused.dialog.closed, false);
  assert.ok(refused.buttons.every((button) => button.disabled === false));
  env.log.invalid = false;
  const renders = env.log.renders;
  const ok = open("P-STK-01", "  ฉลาก  ");
  await ok.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(saves().at(-1)[1])), { p_item_code: "P-STK-01", p_category: "ฉลาก" });
  assert.equal(ok.dialog.closed, true);
  assert.ok(env.log.renders > renders);
  assert.deepEqual(JSON.parse(JSON.stringify(D.partCategories().categories)).find((row) => row.itemCode === "P-STK-01"), { itemCode: "P-STK-01", category: "ฉลาก" }, "the new category is used at once");
  assert.equal(bodyRows(await env.openSt("tab=stock&cat=ฉลาก")).length, 1);
  await open("P-BOX-01", "").submit();
  assert.deepEqual(JSON.parse(JSON.stringify(saves().at(-1)[1])), { p_item_code: "P-BOX-01", p_category: "" }, "empty clears the category");
  assert.ok(bodyRows(await env.openSt("tab=stock&cat=ของซื้อ")).some((row) => row.includes("P-BOX-01")));
  // ผู้อ่าน (PP): หมวดเป็นข้อความใต้ชื่อใน dialog ไม่มีช่องหมวด
  const reader = load({ employee: emp("PP") });
  reader.log.categories = [{ itemCode: "P-BOX-01", category: "หีบห่อทดสอบ" }];
  await settled(reader.openSt, "tab=stock");
  const readOnly = reader.context.MNP_BOM_DIALOGS.costPrice({ ...reader.context.MNP_BOM.context(new URLSearchParams()), guest: null }, { kind: "part", code: "P-BOX-01" }).html;
  assert.doesNotMatch(readOnly, /data-cost-category|name="category"/);
  assert.match(readOnly, /<p class="muted small">[^<]*· หมวด หีบห่อทดสอบ<\/p>/);
  // โหลดหมวดไม่สำเร็จ: ของซื้อยังอยู่ใต้ ของซื้อ · บรรทัดเดียวพร้อมลองอีกครั้ง (ไม่เปิดเผยข้อความภายใน) · ปฏิเสธ = เงียบ
  const broken = load({ employee: emp("ST") });
  const real = broken.context.sb;
  broken.context.sb = { rpc: async (name, args) => (name === "app_rf_part_categories" ? { data: null, error: { message: "down" } } : real.rpc(name, args)) };
  const failed = await settled(broken.openSt, "tab=stock");
  assert.equal((failed.match(/data-cost-retry/g) ?? []).length, 1);
  assert.doesNotMatch(failed, /down/);
  assert.match(failed, /<th[^>]*>ราคา\/หน่วย/, "prices still show");
  const denied = load({ employee: emp("ST") });
  const realDenied = denied.context.sb;
  denied.context.sb = { rpc: async (name, args) => (name === "app_rf_part_categories" ? { data: null, error: { message: "RF_FORBIDDEN" } } : realDenied.rpc(name, args)) };
  assert.doesNotMatch(await settled(denied.openSt, "tab=stock"), /data-cost-retry/);
  assert.equal(denied.context.MNP_COST_DATA.partCategories().status, "forbidden");
});

test("#/cost: เฉพาะผู้เห็นต้นทุนในโหมดทดสอบ · ที่เหลือไม่พบหน้า และไม่เรียก RPC", async () => {
  for (const employee of [emp("ST"), emp("RB"), emp("OFFICE", "assistant_factory_manager"), { ...emp("PP"), isSandbox: false }]) {
    const env = load({ employee });
    await env.openCost();
    assert.equal(env.log.notFound, 1, JSON.stringify(employee));
    assert.equal(env.log.rpc.length, 0);
  }
  const env = load({ employee: emp("PP") });
  const first = await env.openCost();
  assert.match(first, /กำลังโหลดข้อมูลต้นทุน/);
  assert.equal(env.log.rpc.filter(([name]) => name === "app_rf_cost_data").length, 1);
});

test("#/cost: รายการสูตร — หนึ่งแถวต่อรหัส (revision ที่ใช้งาน) ต้นทุนต่อ batch / kg ป้ายขาดราคา · ค้นหา", async () => {
  const env = load({ employee: emp("PP") });
  const html = await settled(env.openCost);
  assert.equal(h1Of(html), "ต้นทุนการผลิต");
  const rows = (html.match(/<tbody>([\s\S]*?)<\/tbody>/) ?? [])[1].split("<tr").slice(1);
  assert.equal(rows.length, 2, "DEMO-W01 (สองฉบับ) รวมเป็นแถวเดียว + RC-OLD");
  assert.match(rows[0], /DEMO-W01/);
  assert.match(rows[0], /rev 2/, "ฉบับที่อนุมัติ");
  assert.match(rows[0], /75\.6 kg/);
  assert.match(rows[0], /ขาดราคา 2/);
  assert.match(rows[0], /≥ /, "ยอดบางส่วนมีเครื่องหมาย");
  assert.match(rows[0], /href="#\/cost\?recipe=DEMO-W01"/);
  // ราคา 10 บาททุกตัว ยกเว้นไม่มีราคา DM-FIL-C 15 kg และ DM-CH-05 0.09 kg: (75.6 − 15.09) × 10 = 605.10
  assert.match(rows[0], /605\.10/);
  assert.match(rows[1], /RC-OLD/);
  assert.doesNotMatch(rows[1], /ขาดราคา/, "PHR: EPDM-55 และ S-80 มีราคา");
  // legacy 60 kg: ทุกตัวราคา 10 → 600.00 · 10.00 บาท/kg
  assert.match(rows[1], /600\.00/);
  assert.match(rows[1], /10\.00/);
  const search = await env.openCost("q=OLD");
  assert.match(search, /RC-OLD/);
  assert.doesNotMatch(search, /DEMO-W01/);
  assert.match(await env.openCost("q=zzz"), /ไม่พบสูตรที่ค้นหา/);
});

test("#/cost?recipe=: ต้นทุนต่อชุดผสม/kg · แยกตามขั้น น้ำหนักตามหน่วยที่กรอก · เคมีที่ไม่มีราคาเห็นชัด · ฉบับของสูตร · ราคา ณ วันที่", async () => {
  const env = load({ employee: emp("OFFICE", "general_manager") });
  const html = await settled(env.openCost, "recipe=DEMO-W01");
  assert.equal(h1Of(html), "DEMO-W01 · FG-91");
  assert.match(html, /วัตถุดิบต่อชุดผสม/);
  assert.match(html, /≥ 605\.10 บาท/);
  assert.match(html, /ค่าแรงต่อชุดผสม<\/span><strong class="rf-stat-value">441\.00 บาท/, "ค่าแรงครบ ไม่มีเครื่องหมาย ≥");
  assert.match(html, /≥ 1,046\.10 บาท/, "รวม = วัตถุดิบ + ค่าแรง เป็นยอดบางส่วนเพราะราคาเคมีไม่ครบ");
  assert.match(html, /≥ 13\.84 บาท/, "รวมต่อ kg เป็นยอดบางส่วนด้วย");
  assert.equal((html.match(/≥/g) ?? []).length, 3, "เครื่องหมาย ≥ เฉพาะสามยอดหัวหน้า ไม่ซ้ำที่ยอดรวมแต่ละขั้น");
  assert.doesNotMatch(html, /ยังไม่ครบ/, "ข้อเท็จจริงว่าราคาไม่ครบแสดงที่กล่องเตือนกล่องเดียว");
  assert.match(html, /แยกตามขั้น/);
  assert.match(html, /ยังไม่มีราคา 2 รายการ/);
  assert.match(html, /DM-FIL-C · ชื่อ DM-FIL-C/);
  assert.match(html, /DM-CH-05 · ชื่อ DM-CH-05/);
  // ลิงก์ไปรายการที่ยังไม่มีราคาในหน้า ในคลัง (ไม่มีเมนูราคาแยก) เฉพาะผู้ที่เปิดโมดูล ST ได้ · เปิดไม่ได้ = ข้อความ ไม่มีลิงก์
  assert.match(html, /href="#\/st\?tab=stock&amp;price=missing"/);
  assert.doesNotMatch(html, /tab=prices/);
  const noSt = load({ employee: emp("ID", "general_manager") });
  assert.equal(noSt.context.MNP_FACTORY.canOpenDeptModule(noSt.context.state.employee, "ST", "FACTORY_ST"), false, "แผนก ID เปิดโมดูล ST ไม่ได้");
  const plain = await settled(noSt.openCost, "recipe=DEMO-W01");
  assert.doesNotMatch(plain, /href="#\/st/, "ไม่มีลิงก์ตาย");
  assert.match(plain, /ราคาตั้งที่รายการ/);
  for (const label of ["ขั้นเตรียมวัตถุดิบ", "ขั้น 1", "ขั้น 2", "ขั้น 3"]) assert.match(html, new RegExp(`<h2>${label}</h2>`), label);
  assert.match(html, /350 g/, "ขั้น 1 แสดงเป็นกรัมตามที่กรอก");
  assert.match(html, /11 kg/);
  assert.match(html, /75\.6 kg/);
  assert.match(html, /71 kg/, "น้ำหนักรวมของขั้นเตรียม");
  assert.match(html, /ยังไม่มีราคา<\/span>/, "แถวที่ไม่มีราคามีป้าย");
  // ฉบับของสูตร: มีสองฉบับ = ตัวเลือก
  assert.match(html, /id="cost-rev"/);
  assert.match(html, /rev 1 · ถูกแทนที่/);
  // วันที่ราคา: ก่อนมีราคาใดๆ ทุกตัวไม่มีราคา
  const early = await env.openCost("recipe=DEMO-W01&asof=2025-01-01");
  assert.match(early, /ยังไม่มีราคา 18 รายการ/, "ตัวที่น้ำหนัก 0 ไม่นับ");
  assert.doesNotMatch(early, /≥ 605/);
  // สูตรที่ไม่พบ
  assert.match(await env.openCost("recipe=NOPE"), /ไม่พบสูตรนี้/);
  // สูตรครบราคา: ไม่มีกล่องเตือน
  const legacy = await env.openCost("recipe=RC-OLD");
  assert.doesNotMatch(legacy, /ยังไม่มีราคา \d+ รายการ|ยังไม่ครบ/);
  assert.match(legacy, /<h2>ขั้น 1<\/h2>/);
  assert.doesNotMatch(legacy, /ขั้นเตรียมวัตถุดิบ/);
  assert.doesNotMatch(legacy, /id="cost-rev"/, "ฉบับเดียว = ไม่มีตัวเลือก");
});

test("#/cost: เทียบกับจริงรายล็อต — ของสูตรและทุกสูตร · ผลต่างมีเครื่องหมาย · ไม่มีล็อต = ข้อความว่าง", async () => {
  const env = load({ employee: emp("AD", "admin") });
  const tab = await settled(env.openCost, "recipe=DEMO-W01&tab=lots");
  assert.match(tab, /MX-100/);
  assert.match(tab, /MX-101/);
  // MX-100: ชั่ง DM-RUB-A 23 kg × 10 = 230 · สูตร 2 batch × (75.6 − 15.09) × 10 = 1,210.20 (ไม่รวม DM-FIL-C / DM-CH-05 ที่ไม่มีราคา) ราคาไม่ครบ
  assert.match(tab, /ขาดราคา 2/, "ราคาสูตรไม่ครบ = ป้ายเตือนที่ล็อต");
  assert.match(tab, /cost-diff/);
  const general = await env.openCost("tab=lots");
  assert.equal(h1Of(general), "สูตรเทียบจริง");
  assert.match(general, /DEMO-W01 rev 2/);
  assert.equal(costMenuActive(env), "สูตรเทียบจริง");
  const searched = await env.openCost("tab=lots&q=MX-101");
  assert.match(searched, /MX-101/);
  assert.doesNotMatch(searched, /MX-100/);
  assert.match(await env.openCost("tab=lots&q=zzz"), /ไม่พบล็อตที่ค้นหา/);
  assert.match(await env.openCost("recipe=RC-OLD&tab=lots"), /ยังไม่มีล็อตผสมของสูตรนี้/);
});
const costMenuActive = (env) => {
  const html = env.modules.FACTORY_COST.nav[0].subnav("cost");
  return (html.match(/is-active"[^>]*>[\s\S]*?<span class="rf-nav-text">([^<]*)</) ?? [])[1];
};

test("#/cost: ฐานข้อมูลปฏิเสธ = ไม่มีสิทธิ์ · โหลดไม่สำเร็จ = ลองอีกครั้ง · เปลี่ยนบัญชี = ทิ้งข้อมูลที่ถือไว้", async () => {
  const denied = load({ employee: emp("PP") });
  denied.context.sb = { rpc: async () => ({ data: null, error: { message: "RF_FORBIDDEN" } }) };
  assert.match(await settled(denied.openCost), /ไม่มีสิทธิ์ดูต้นทุนการผลิต/);
  const broken = load({ employee: emp("PP") });
  broken.context.sb = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
  const html = await settled(broken.openCost);
  assert.match(html, /data-cost-retry/);
  assert.doesNotMatch(html, /boom/);
  const env = load({ employee: emp("PP", "employee", { id: "a" }) });
  await settled(env.openCost);
  assert.deepEqual(env.log.rpc.map(([name]) => name).sort(), ["app_rf_cost_data", "app_rf_labour"]);
  env.setEmployee(emp("PP", "employee", { id: "b" }));
  assert.match(await env.openCost(), /กำลังโหลดข้อมูลต้นทุน/, "บัญชีใหม่ไม่เห็นข้อมูลของบัญชีเดิม");
  assert.equal(env.log.rpc.filter(([name]) => name === "app_rf_cost_data").length, 2);
  assert.equal(env.log.rpc.filter(([name]) => name === "app_rf_labour").length, 2, "ข้อมูลค่าแรงของบัญชีเดิมถูกทิ้งด้วย");
});

test("#/cost: ตัวเลือกฉบับ/วันที่เปลี่ยน URL · ไม่เก็บราคาลงเครื่อง · โหลดครั้งเดียว", async () => {
  const env = load({ employee: emp("PP") });
  await settled(env.openCost, "recipe=DEMO-W01");
  const select = { name: "rev", value: "1", handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const date = { name: "asof", value: "2026-03-01", handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  env.fakes["[data-cost-filter]"] = [select, date];
  await env.openCost("recipe=DEMO-W01&tab=lots");
  select.handlers.change();
  assert.equal(env.log.hash, "#/cost?recipe=DEMO-W01&rev=1&tab=lots");
  date.handlers.change();
  assert.equal(env.log.hash, "#/cost?recipe=DEMO-W01&asof=2026-03-01&tab=lots");
  assert.ok(!(env.log.stored ?? []).some((entry) => /unitPrice|effectiveFrom/.test(entry)), "ไม่มีราคา/ต้นทุนลง localStorage");
  assert.equal(env.log.rpc.filter(([name]) => name === "app_rf_cost_data").length, 1);
});

test("wording และไฟล์: โมดูลลงทะเบียนอย่างเดียว · ไม่มี data-rf-form ในหน้าต้นทุน (อ่านอย่างเดียว) · ข้อความจากข้อมูลถูก escape", async () => {
  assert.match(read("modules/module-cost.js"), /MNP_REQUEST_MODULES/);
  const env = load({ employee: emp("PP") });
  env.context.sb = { rpc: async () => ({ data: { ...COST_DATA, materials: COST_DATA.materials.map((m) => ({ ...m, name: m.code === "DM-FIL-C" ? "<b>x</b>" : m.name })) }, error: null }) };
  const html = await settled(env.openCost, "recipe=DEMO-W01");
  assert.doesNotMatch(html, /data-rf-form|data-rf-action/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});

// ---------- ค่าแรง (เฟส 2) ----------
test("#/cost: รายการสูตรมีค่าแรงและยอดรวมต่อชุดผสม / ต่อ kg · สูตรที่คิดค่าแรงไม่ได้มีป้ายบอกเหตุ · ปุ่มอัตราค่าแรง", async () => {
  const env = load({ employee: emp("PP") });
  const html = await settled(env.openCost);
  const rows = (html.match(/<tbody>([\s\S]*?)<\/tbody>/) ?? [])[1].split("<tr").slice(1);
  assert.match(rows[0], /441\.00/, "ค่าแรงของ DEMO-W01 (สินค้า FG-91)");
  assert.match(rows[0], /≥ 1,046\.10/);
  assert.match(rows[0], /≥ 13\.84/);
  assert.doesNotMatch(rows[0], /ยังไม่มีค่าแรง/);
  assert.match(rows[1], /RC-OLD/);
  assert.match(rows[1], /ยังไม่มีค่าแรง/);
  assert.match(rows[1], /title="(สูตรยังไม่มีรหัสสินค้า|สินค้านี้ยังไม่มีเวลามาตรฐาน)/, "เหตุอยู่ใน title");
  assert.match(html, /data-rf-open="labourRates"/);
  assert.equal((html.match(/<th[ >]/g) ?? []).length, 7, "สูตร น้ำหนัก วัตถุดิบ ค่าแรง รวม รวม/kg และป้าย");
});

test("#/cost?recipe=&tab=labour: ค่าแรงแยกตามขั้นและสถานี · อัตราที่ใช้ · ปุ่มเวลามาตรฐาน / อัตราค่าแรง · คิดไม่ได้ = บอกเหตุ", async () => {
  const env = load({ employee: emp("OFFICE", "general_manager") });
  const html = await settled(env.openCost, "recipe=DEMO-W01&tab=labour");
  assert.match(html, /ค่าแรงแยกตามขั้น/);
  assert.match(html, /อัตรา RB 60\.00 บาท\/ชม\./);
  assert.match(html, /ผสม · ขั้นเตรียมวัตถุดิบ<\/td><td class="right rf-mono">30<\/td><td class="right rf-mono">2<\/td><td class="right rf-mono">1\.00<\/td><td class="right rf-mono">60\.00/);
  // ตารางเดียว: แถวรวมของสถานีผสม (4 ส่วน) ต่อจากขั้น 3 · แถวรวมท้ายมีแค่นาทีและชั่วโมงคน (ค่าแรงรวมอยู่ที่ตัวเลขด้านบนที่เดียว) · ไม่มีการ์ดตามสถานีที่ซ้ำตัวเลขเดิม
  assert.match(html, /ผสม · ขั้น 3<\/td>(?:(?!<\/tr>).)*<\/tr><tr class="cost-sum"><td title="[^"]*">รวมสถานีผสมยาง<\/td><td class="right rf-mono">48<\/td><td><\/td><td class="right rf-mono">1\.60<\/td><td class="right rf-mono">96\.00<\/td><\/tr><tr><td>ฉีดขึ้นรูป/);
  assert.match(html, /<strong>รวม<\/strong><\/td><td class="right rf-mono">183<\/td><td><\/td><td class="right rf-mono">7\.35<\/td><td><\/td><\/tr>/);
  assert.equal((html.match(/441\.00/g) ?? []).length, 1, "the labour total appears once (the summary figure)");
  assert.doesNotMatch(html, /ค่าแรงตามสถานี/);
  assert.equal((html.match(/<table/g) ?? []).length, 1, "one labour table");
  assert.match(html, /data-rf-open="stationStandard" data-rf-args="[^"]*FG-91/);
  assert.match(html, /data-rf-open="labourRates"/);
  assert.doesNotMatch(html, /ยังคิดค่าแรงไม่ได้/);
  // วันที่ก่อนเวลามาตรฐานมีผล: คิดไม่ได้ บอกเหตุ และยอดรวมเป็นยอดบางส่วน
  const early = await env.openCost("recipe=DEMO-W01&tab=labour&asof=2025-06-01");
  assert.match(early, /ยังคิดค่าแรงไม่ได้/);
  assert.match(early, /สินค้านี้ยังไม่มีเวลามาตรฐานที่มีผล/);
  assert.match(early, /ค่าแรงต่อชุดผสม<\/span><strong class="rf-stat-value">-</);
  // สูตรที่ไม่มีรหัสสินค้า / ไม่มีเวลามาตรฐาน
  const legacy = await env.openCost("recipe=RC-OLD&tab=labour");
  assert.match(legacy, /ยังคิดค่าแรงไม่ได้/);
  // ไม่มีอัตราของ RB
  const noRate = load({ employee: emp("PP") });
  noRate.log.labour = { ...LABOUR, rates: [] };
  const plain = await settled(noRate.openCost, "recipe=DEMO-W01&tab=labour");
  assert.match(plain, /ยังไม่มีอัตราค่าแรงของแผนก RB ที่มีผล/);
  assert.match(plain, /ผสม · ขั้น 1<\/td><td class="right rf-mono">12</, "เวลายังแสดง แม้ยังไม่มีอัตรา");
});

test("ค่าแรง: ระหว่างโหลดไม่มีป้าย · โหลดไม่สำเร็จ = บรรทัดเดียวเหนือตารางพร้อมลองอีกครั้ง (ไม่ใช่ป้ายทุกแถว) หน้าต้นทุนวัตถุดิบยังใช้ได้", async () => {
  // ระหว่างโหลด: ช่องค่าแรงเป็นขีด ไม่มีแถวไหนบอกว่ายังไม่มีค่าแรง
  const waiting = load({ employee: emp("PP") });
  const realWaiting = waiting.context.sb;
  waiting.context.sb = { rpc: (name, args) => (name === "app_rf_labour" ? new Promise(() => {}) : realWaiting.rpc(name, args)) };
  const pending = await settled(waiting.openCost);
  assert.equal(waiting.context.MNP_COST_DATA.labour().status, "loading");
  assert.match(pending, /605\.10/);
  assert.doesNotMatch(pending, /ยังไม่มีค่าแรง|data-cost-retry/);

  const env = load({ employee: emp("PP") });
  const real = env.context.sb;
  env.context.sb = { rpc: async (name, args) => (name === "app_rf_labour" ? { data: null, error: { message: "boom" } } : real.rpc(name, args)) };
  const html = await settled(env.openCost);
  assert.match(html, /605\.10/);
  assert.doesNotMatch(html, /ยังไม่มีค่าแรง/, "no row claims that the labour cost is missing");
  assert.equal((html.match(/data-cost-retry="labour"/g) ?? []).length, 1, "one retry line above the table");
  assert.match(html, /โหลดข้อมูลค่าแรงไม่สำเร็จ <button[^>]*data-cost-retry="labour"[^>]*>ลองอีกครั้ง<\/button><\/p>[\s\S]*<table/, "the line sits above the table");
  assert.doesNotMatch(html, /boom/);
  const tab = await env.openCost("recipe=DEMO-W01&tab=labour");
  assert.match(tab, /โหลดข้อมูลค่าแรงไม่สำเร็จ/);
  assert.equal((tab.match(/data-cost-retry="labour"/g) ?? []).length, 1, "the labour tab keeps its own single retry");
  // หน้าสูตร แท็บวัตถุดิบ: บรรทัดลองอีกครั้งบรรทัดเดียวเหนือตารางวัตถุดิบ (ช่อง ค่าแรงต่อชุดผสม ข้างบนเป็นขีด)
  const materials = await env.openCost("recipe=DEMO-W01");
  assert.equal((materials.match(/data-cost-retry="labour"/g) ?? []).length, 1, "one retry on the materials tab");
  assert.match(materials, /ค่าแรงต่อชุดผสม<\/span><strong class="rf-stat-value">-<[\s\S]*โหลดข้อมูลค่าแรงไม่สำเร็จ <button[^>]*data-cost-retry="labour"[^>]*>ลองอีกครั้ง<\/button><\/p>[\s\S]*<table/, "the line sits above the materials table");
  // ลองอีกครั้ง: โหลดค่าแรงใหม่ทันที (error ไม่โหลดซ้ำเองเมื่อวาดหน้า) แล้วตารางมีค่าแรง
  const calls = () => env.log.rpc.filter(([name]) => name === "app_rf_labour").length;
  assert.equal(env.context.MNP_COST_DATA.needsLabour(), false, "an error is not retried by a repaint");
  env.context.sb = real;
  assert.equal(calls(), 0, "the failing stub logs nothing");
  const retry = { disabled: false, handlers: {}, getAttribute: (name) => (name === "data-cost-retry" ? "labour" : null), addEventListener(type, handler) { this.handlers[type] = handler; } };
  env.fakes["[data-cost-retry]"] = [retry];
  await env.openCost();
  retry.handlers.click();
  assert.equal(retry.disabled, true);
  await tick(); await tick();
  assert.equal(calls(), 1, "the retry called app_rf_labour");
  assert.equal(env.context.MNP_COST_DATA.labour().status, "ready");
  delete env.fakes["[data-cost-retry]"];
  const fixed = await env.openCost();
  assert.doesNotMatch(fixed, /data-cost-retry/);
  assert.match(fixed, /441\.00/);
  assert.doesNotMatch(await env.openCost("recipe=DEMO-W01"), /data-cost-retry/, "no retry once the labour data is loaded");
});

test("ค่าแรงแยกตามขั้น: ขั้นนอกสถานีผสมเป็น 0 ทุกขั้น = ไม่มีแถวรวมสถานีผสม (ตัวเลขเท่าแถวรวม)", async () => {
  const env = load({ employee: emp("PP") });
  // ตัวเลขสมมติ: มีแต่ขั้นผสม (30 + 12 + 6 นาที)
  env.log.labour = { ...LABOUR, standards: [{ ...LABOUR.standards[0], steps: stepsOf([30, 12, 6, 0, 0, 0, 0], [2, 2, 2, 0, 0, 0, 0]) }] };
  const html = await settled(env.openCost, "recipe=DEMO-W01&tab=labour");
  assert.doesNotMatch(html, /รวมสถานี/, "no subtotal that repeats the total");
  assert.match(html, /<strong>รวม<\/strong><\/td><td class="right rf-mono">48<\/td>/);
  assert.match(html, /ฉีดขึ้นรูป<\/td><td class="right rf-mono">0<\/td>/, "the zero steps still list");
});

test("หน้าสูตรยาง: ตารางเวลามาตรฐานของรหัสสินค้า · แผนก RB เห็นเวลา ไม่เห็นค่าแรง · หัวหน้า RB แก้ได้ · คนอื่นไม่เห็นอะไร", async () => {
  const section = async (employee, recipe = DEMO) => {
    const env = load({ employee });
    env.context.MNP_COST_LABOUR.recipeSection(recipe);
    await tick(); await tick();
    return { env, html: env.context.MNP_COST_LABOUR.recipeSection(recipe) };
  };
  const staff = await section(emp("RB"));
  assert.match(staff.html, /เวลามาตรฐานต่อชุดผสม/);
  assert.match(staff.html, /ผสม · ขั้นเตรียมวัตถุดิบ<\/td><td class="right rf-mono">30<\/td><td class="right rf-mono">2</);
  assert.match(staff.html, /สินค้า FG-91 · รวม 183 นาที/);
  assert.match(staff.html, />ประวัติเวลามาตรฐาน</, "พนักงาน RB ดูประวัติได้ แก้ไม่ได้");
  assert.doesNotMatch(staff.html, /บาท|แก้เวลามาตรฐาน/, "ไม่มีค่าแรงหรือปุ่มแก้");
  assert.deepEqual(staff.env.log.rpc.map(([name]) => name), ["app_rf_labour"], "โหลดครั้งเดียว ไม่เรียกข้อมูลต้นทุน");
  const head = await section(emp("RB", "department_manager"));
  assert.match(head.html, />แก้เวลามาตรฐาน</);
  const fresh = await section(emp("RB", "assistant_department_manager"), { ...DEMO, productCode: "FG-NEW" });
  assert.match(fresh.html, /สินค้า FG-NEW ยังไม่มีเวลามาตรฐาน/);
  assert.match(fresh.html, />ตั้งเวลามาตรฐาน</);
  const blank = await section(emp("RB", "department_manager"), { ...DEMO, productCode: "" });
  assert.match(blank.html, /ยังไม่มีรหัสสินค้า/);
  assert.doesNotMatch(blank.html, /data-rf-open/);
  for (const who of [emp("QA"), emp("ST"), emp("GR", "department_manager"), emp("FT", "assistant_factory_manager"), { ...emp("RB"), isSandbox: false }]) {
    const other = await section(who);
    assert.equal(other.html, "", "ไม่แสดงส่วนนี้");
    assert.equal(other.env.log.rpc.length, 0, "และไม่เรียก RPC");
  }
});

test("dialog เวลามาตรฐาน / อัตราค่าแรง: ฟอร์มเฉพาะผู้มีสิทธิ์แก้ · ประวัติ · แผนก RB ไม่มี dialog อัตรา · ข้อความถูก escape", async () => {
  const ready = async (employee, labour = LABOUR) => {
    const env = load({ employee });
    env.log.labour = labour;
    env.context.MNP_COST_LABOUR.labourReady();
    await tick(); await tick();
    return env.context.MNP_COST_LABOUR;
  };
  const noted = { ...LABOUR, standards: [{ ...LABOUR.standards[0], note: NOTE_XSS }], rates: [{ ...LABOUR.rates[0], note: NOTE_XSS }] };
  const pp = await ready(emp("PP"), noted);
  const standard = pp.standardDialog({ productCode: "FG-91" }).html;
  assert.match(standard, /เวลามาตรฐาน · สินค้า FG-91/);
  assert.match(standard, /data-cost-standard/);
  assert.equal((standard.match(/name="minutes\./g) ?? []).length, 7);
  assert.equal((standard.match(/name="workers\./g) ?? []).length, 7);
  assert.match((standard.match(/<input[^>]*name="minutes\.prep"[^>]*>/) ?? [""])[0], /value="30"/, "ค่าตั้งต้น = แถวล่าสุด");
  assert.match(standard, /ใช้อยู่/);
  assert.doesNotMatch(standard, /<img src=x/);
  assert.doesNotMatch(standard, /data-rf-form/, "ไม่ผ่านคำสั่งของ RubberFlow");
  const rates = pp.ratesDialog().html;
  assert.match(rates, /data-cost-rate/);
  assert.match(rates, /60\.00/);
  assert.match(rates, /ยังไม่มีอัตรา/, "แผนกที่ยังไม่มีอัตรา");
  assert.doesNotMatch(rates, /<img src=x/);
  assert.equal(pp.standardDialog({ productCode: "" }), null);
  const staff = await ready(emp("RB"));
  const view = staff.standardDialog({ productCode: "FG-91" }).html;
  assert.doesNotMatch(view, /data-cost-standard|บันทึกเวลามาตรฐาน/, "พนักงาน RB ดูอย่างเดียว");
  assert.match(view, /183/);
  assert.equal(staff.ratesDialog(), null, "แผนก RB ไม่มี dialog อัตราค่าแรง");
  const head = await ready(emp("RB", "department_manager"));
  assert.match(head.standardDialog({ productCode: "FG-91" }).html, /data-cost-standard/);
  assert.equal(head.ratesDialog(), null);
  const qa = await ready(emp("QA"));
  assert.equal(qa.standardDialog({ productCode: "FG-91" }), null);
});

test("ตัวโหลดค่าแรง: บันทึกแล้วข้อมูลใหม่ใช้ทันที · ข้อผิดพลาดเป็นข้อความไทย · ไม่เก็บลงเครื่อง", async () => {
  const env = load({ employee: emp("PP") });
  const D = env.context.MNP_COST_DATA;
  await D.loadLabour();
  assert.equal(D.labour().status, "ready");
  assert.equal(D.labour().rates.length, 1);
  const saved = await D.saveRate({ departmentCode: "GR", ratePerHour: 55, effectiveFrom: "2026-11-01", note: "x" });
  assert.equal(saved.ok, true);
  assert.equal(JSON.stringify(env.log.rpc.at(-1)), JSON.stringify(["app_rf_labour_rate_save", { p_department_code: "GR", p_rate_per_hour: 55, p_effective_from: "2026-11-01", p_note: "x" }]));
  assert.equal(D.labour().rates.length, 2);
  const steps = stepsOf([1, 2, 3, 4, 5, 6, 7], [1, 1, 1, 1, 1, 1, 1]);
  assert.equal((await D.saveStandard({ productCode: "FG-91", effectiveFrom: "2026-11-01", steps })).ok, true);
  assert.equal(JSON.stringify(env.log.rpc.at(-1)), JSON.stringify(["app_rf_station_standard_save", { p_product_code: "FG-91", p_effective_from: "2026-11-01", p_steps: steps, p_note: "" }]));
  assert.equal(D.labour().standards.length, 2);
  env.log.invalid = true;
  assert.match((await D.saveRate({ departmentCode: "GR", ratePerHour: 55, effectiveFrom: "2026-11-01" })).message, /ข้อมูลอัตราค่าแรงไม่ถูกต้อง/);
  assert.match((await D.saveStandard({ productCode: "FG-91", effectiveFrom: "2026-11-01", steps })).message, /ข้อมูลเวลามาตรฐานไม่ถูกต้อง/);
  assert.equal(D.labour().standards.length, 2, "ข้อมูลเดิมคงอยู่เมื่อบันทึกไม่ผ่าน");
  assert.equal((env.log.stored ?? []).filter((entry) => /labour|rate|standard/i.test(entry)).length, 0);
  const rb = load({ employee: emp("RB") });
  const denied = await rb.context.MNP_COST_DATA.saveRate({ departmentCode: "RB", ratePerHour: 1, effectiveFrom: "2026-11-01" });
  assert.deepEqual([denied.ok, denied.forbidden], [false, true]);
});

// ---------- ต้นทุนต่อชิ้น (เฟส 3) ----------
// ข้อมูลสาธิตของ BOM (modules/bom-seed.js): เป้า GR ของปลอกห่วงฮูล่า SE-HL24 (ตัดยาง 20 ชิ้น/ชม. 2 คน · เจาะ 12 ชิ้น/ชม. 1 คน) · เทสต์เพิ่มเป้า PK ของฮูล่า DEMO-HL-24(B)-A
// อัตราสมมติ GR 50 · PK 40 บาท/ชม. · ราคาของซื้อ P-BOX-01 4.50 (P-STK-01 ไม่มีราคา)
const RATE = (departmentCode, ratePerHour) => ({ id: `r-${departmentCode}`, departmentCode, ratePerHour, effectiveFrom: "2026-01-01", note: "", createdAt: 2, createdBy: "ผู้ทดสอบ" });
function itemEnv({ employee = emp("PP"), rates = [RATE("GR", 50), RATE("PK", 40)] } = {}) {
  const env = load({ employee });
  env.log.labour = { ...LABOUR, rates: [...LABOUR.rates, ...rates] };
  const store = env.context.MNP_BOM.store;
  store.setUser("B03");
  const R = env.context.MNP_BOM_RULES;
  const pk = R.grConfig(store.data(), "PK");
  const saved = store.run("saveGrConfig", { dept: "PK", steps: pk.steps, reasons: pk.reasons, targets: [{ itemCode: "DEMO-HL-24(B)-A", stepCode: "PK-01", perHour: 30, people: 2 }, { itemCode: "DEMO-HL-24(B)-A", stepCode: "PK-03", perHour: 60, people: 1 }] });
  assert.equal(saved.ok, true, String(saved.error?.message ?? ""));
  return env;
}
const rowOf = (html, code) => bodyRows(html).find((row) => row.includes(`>${code}</a>`)) ?? "";

test("#/cost?tab=items: ต้นทุนต่อชิ้นของชิ้นที่ผลิตเอง · ค่าแรงแผนก วัตถุดิบ รวมที่ชิ้นนี้ · ≥ เมื่อไม่ครบ · ป้ายเตือนพร้อมรายละเอียด · ค้นหา", async () => {
  const env = itemEnv();
  const html = await settled(env.openCost, "tab=items");
  assert.equal(h1Of(html), "ต้นทุนต่อชิ้น");
  assert.match(costMenu(env).join("|"), /ต้นทุนต่อชิ้น/);
  assert.match(env.modules.FACTORY_COST.nav[0].subnav("cost"), /href="#\/cost\?tab=items"/);
  assert.match(html, /<th[^>]*>ค่าแรงแผนก \(บาท\/ชิ้น\)<\/th>/);
  // ครบ: GR 50 × 2 ÷ 20 = 5 + 50 × 1 ÷ 12 = 4.1667 → 9.1667 · ไม่มีของซื้อ (เส้นยางเป็นชิ้นที่ผลิตเอง)
  const se = rowOf(html, "SE-HL24-YE03-400-19-30");
  assert.match(se, /9\.1667/);
  assert.doesNotMatch(se, /≥|ขาดราคา|ยังไม่มี/);
  // ไม่ครบ: PK 40 × 2 ÷ 30 + 40 ÷ 60 = 3.3333 · กล่อง 0.125 × 4.50 = 0.5625 · สติ๊กเกอร์ยังไม่มีราคา
  const fg = rowOf(html, "DEMO-HL-24(B)-A");
  assert.match(fg, /3\.3333/);
  assert.match(fg, /≥ 0\.5625/);
  assert.match(fg, /≥ 3\.8958/);
  assert.match(fg, /title="P-STK-01"[^>]*>[\s\S]*?ขาดราคา 1/);
  // BG ยังไม่ตั้งเป้า: ค่าแรงเป็นขีด ป้ายบอกแผนก
  const bg = rowOf(html, "BG-0092");
  assert.match(bg, /title="แผนก BG ยังไม่ได้ตั้งเป้าชิ้น\/ชม\. ของชิ้นนี้"[^>]*>[\s\S]*?ยังไม่มีเป้า/);
  // ไม่มีของซื้อ สูตรยาง หรือเส้นยางในรายการ
  assert.equal(rowOf(html, "P-BOX-01"), "");
  assert.equal(rowOf(html, "RB-DM02-02-YE03-204-19-34"), "");
  assert.equal(rowOf(html, "DM01"), "");
  assert.doesNotMatch(html, /undefined|NaN/);
  const found = await env.openCost("tab=items&q=hl24");
  assert.ok(rowOf(found, "SE-HL24-YE03-400-19-30") && !rowOf(found, "BG-0092"), "ค้นหาตามรหัส");
  assert.match(await env.openCost("tab=items&q=zzz"), /ไม่พบชิ้นงานที่ค้นหา/);
  assert.ok(!(env.log.stored ?? []).some((entry) => /unitPrice|ratePerHour/.test(entry)), "ไม่มีราคา/อัตราลง localStorage (เป้าเป็นข้อมูล BOM ของโหมดในเครื่อง)");
});

test("#/cost?tab=items: อัตราค่าแรงที่ยังไม่มี = ป้าย ยังไม่มีอัตราค่าแรง (ไม่เดาเป็น 0) · ระหว่างโหลดค่าแรงไม่แสดงป้าย · ผู้ไม่เห็นต้นทุนไม่พบหน้า", async () => {
  const env = itemEnv({ rates: [RATE("PK", 40)] });
  const loading = await env.openCost("tab=items");
  assert.doesNotMatch(loading, /ยังไม่มีอัตราค่าแรง/, "ยังไม่รู้อัตรา = ยังไม่ตัดสิน");
  const html = await settled(env.openCost, "tab=items");
  const se = rowOf(html, "SE-HL24-YE03-400-19-30");
  assert.match(se, /title="ยังไม่มีอัตราค่าแรงที่มีผลของแผนก GR"[^>]*>[\s\S]*?ยังไม่มีอัตราค่าแรง/);
  assert.match(se, /≥ 0\.00/);
  for (const employee of [emp("ST"), emp("GR", "department_manager"), { ...emp("PP"), isSandbox: false }]) {
    const other = load({ employee });
    await other.openCost("tab=items");
    await other.openCost("item=SE-HL24-YE03-400-19-30");
    assert.equal(other.log.notFound, 2, JSON.stringify(employee));
  }
});

test("#/cost?item=: ค่าแรงแยกตามขั้น (อัตราแสดงครั้งเดียว) · วัตถุดิบรวมเผื่อเสีย · ชิ้นที่ผลิตเองยังไม่รวม · ที่แก้สิ่งที่ขาด · ราคา ณ วันที่", async () => {
  const env = itemEnv();
  const se = await settled(env.openCost, "item=SE-HL24-YE03-400-19-30");
  assert.match(h1Of(se), /^SE-HL24-YE03-400-19-30 · /);
  assert.match(se, /href="#\/cost\?tab=items"[^>]*>‹ ต้นทุนต่อชิ้น/);
  assert.match(se, /ค่าแรงแผนก<\/span><strong class="rf-stat-value">9\.1667 บาท/);
  assert.match(se, /<td>GR · ตัดยาง<\/td><td class="right rf-mono">20<\/td><td class="right rf-mono">2<\/td><td class="right rf-mono">3<\/td><td class="right rf-mono">5\.00<\/td>/, "ตัดยาง: 3 นาที/ชิ้น 5.00 บาท/ชิ้น");
  assert.equal((se.match(/อัตรา GR 50\.00 บาท\/ชม\./g) ?? []).length, 1, "อัตราของแผนกแสดงครั้งเดียว");
  assert.match(se, /ชิ้นที่ผลิตเอง \(ยังไม่รวมในยอดนี้\)/);
  assert.match(se, /RB-DM02-02-YE03-204-19-34[\s\S]*?คิดที่ต้นทุนสูตร/);
  assert.match(se, /<input[^>]*name="asof"[^>]*type="date"|<input[^>]*type="date"[^>]*name="asof"/);
  assert.match(se, /BOM ของชิ้นนี้ไม่มีของซื้อ/);
  const fg = await env.openCost("item=DEMO-HL-24(B)-A");
  assert.match(fg, /ของซื้อยังไม่มีราคา 1 รายการ/);
  assert.match(fg, /href="#\/st\?tab=stock&amp;price=missing"/, "ไปตั้งราคาที่ในคลังของ ST");
  assert.match(fg, /P-BOX-01[\s\S]*?0\.125 [^<]*<\/td><td class="right"><span class="rf-mono">4\.50<\/span><\/td><td class="right rf-mono">0\.5625<\/td>/);
  assert.match(fg, /href="#\/cost\?item=SE-HL24-YE03-400-19-30"/, "ลูกที่ผลิตเองลิงก์ไปหน้าของตัวเอง");
  assert.match(fg, /href="#\/cost\?item=BG-0092"/);
  const bg = await env.openCost("item=BG-0092");
  assert.match(bg, /แผนก BG ยังไม่มีเป้าของชิ้นนี้/);
  assert.match(bg, /href="#\/bg\?tab=settings"/, "ไปตั้งเป้าที่หน้าตั้งค่าของแผนก");
  // วันที่ก่อนมีราคาและอัตรา: ทุกอย่างยังคิดไม่ได้
  const early = await env.openCost("item=DEMO-HL-24(B)-A&asof=2025-06-01");
  assert.match(early, /ยังไม่มีอัตราค่าแรงของแผนก PK ที่มีผลในวันนี้/);
  assert.match(early, /ของซื้อยังไม่มีราคา 2 รายการ/);
  assert.match(await env.openCost("item=P-BOX-01"), /ไม่มีต้นทุนต่อชิ้น/);
  assert.match(await env.openCost("item=RB-DM02-02-YE03-204-19-34"), /ไปที่ต้นทุนสูตร/);
  assert.match(await env.openCost("item=NOPE-1"), /ไม่พบชิ้นงานนี้/);
  assert.doesNotMatch(fg + bg + se, /undefined|NaN/);
});
