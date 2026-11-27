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
  "modules/cost-rules.js", "modules/cost-data.js",
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
      if (name === "app_rf_cost_data") return seeCost() ? { data: { ...COST_DATA, prices: log.prices }, error: null } : refuse();
      return { data: null, error: { message: "unknown rpc" } };
    },
  };
}

function load({ employee = emp("ST") } = {}) {
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { renders: 0, notFound: 0, hash: "#/st", toasts: [], rpc: [], prices: PRICES, invalid: false };
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
  assert.deepEqual(costMenu(env), ["ต้นทุนสูตร", "สูตรเทียบจริง"]);
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
  // เคมี: EPDM-55 มีราคา 10 ต่อ kg · ล็อตของวัตถุดิบเดียวกันอยู่ติดกันและมีปุ่มที่แถวแรกเท่านั้น
  const epdm = rows.filter((row) => row.includes(">EPDM-55<"));
  assert.ok(epdm.length >= 2, "เคมีตัวเดียวกันหลายล็อต");
  assert.ok(epdm.every((row) => /10\.00<\/span> <span class="small muted">\/kg/.test(row)), "ราคาแสดงทุกแถวของล็อต");
  assert.equal(epdm.filter((row) => row.includes("data-rf-open=\"costPrice\"")).length, 1, "ปุ่มเดียวต่อวัตถุดิบ");
  assert.match(epdm[0], /data-rf-args="\{&quot;kind&quot;:&quot;chem&quot;,&quot;code&quot;:&quot;EPDM-55&quot;\}"[^>]*>ราคาใหม่</);
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
  assert.ok(rows.length > 0 && rows.every((row) => row.includes("ยังไม่มีราคา")), "ทุกแถวยังไม่มีราคา");
  const zeroChem = rows.find((row) => row.includes(">ZZ-NEW<"));
  assert.match(zeroChem, /0 kg/);
  assert.match(zeroChem, /data-rf-open="costPrice"[\s\S]*>ตั้งราคา</, "ตั้งราคาให้เคมีที่ยังไม่เคยรับเข้าได้");
  assert.doesNotMatch(zeroChem, /href="#\/st\?lot=/, "ไม่มีล็อต");
  const zeroPart = rows.find((row) => row.includes("P-ZERO-01"));
  assert.match(zeroPart, /0 ชิ้น/);
  assert.match(zeroPart, /&quot;kind&quot;:&quot;part&quot;/);
  assert.doesNotMatch(missing, /ZZ-OLD|P-ZERO-OFF/, "ที่เลิกใช้แล้วไม่ขึ้น");
  assert.ok(!rows.some((row) => row.includes(">EPDM-55<")), "ที่มีราคาแล้วไม่ขึ้น");
  assert.match(missing, /ยังไม่มีราคา \(\d+\)/, "จำนวนที่ยังไม่มีราคาอยู่ที่ตัวเลือก");
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
  assert.match(html, /ต้นทุนต่อชุดผสม/);
  assert.match(html, /≥ 605\.10 บาท/);
  assert.match(html, /≥ 8\.00 บาท/, "ต้นทุนต่อ kg เป็นยอดบางส่วนด้วย");
  assert.equal((html.match(/≥/g) ?? []).length, 2, "เครื่องหมาย ≥ เฉพาะสองยอดหัวหน้า ไม่ซ้ำที่ยอดรวมแต่ละขั้น");
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
  assert.equal(env.log.rpc.length, 1);
  env.setEmployee(emp("PP", "employee", { id: "b" }));
  assert.match(await env.openCost(), /กำลังโหลดข้อมูลต้นทุน/, "บัญชีใหม่ไม่เห็นข้อมูลของบัญชีเดิม");
  assert.equal(env.log.rpc.length, 2);
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
