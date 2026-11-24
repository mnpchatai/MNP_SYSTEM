import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// ส่วนข้อมูลล้วนของทะเบียนอุปกรณ์ IT (modules/itas-model.js): วันที่ ฟอร์มจากนิยามช่อง ตรวจค่า พารามิเตอร์ของ app_itas_save_asset (ไม่ส่งช่องลับตอนตู้เซฟล็อก ไม่มี plaintext)
// ตาราง/ค้นหา/เรียง ประวัติ (ช่องลับแสดงว่า "เปลี่ยนค่า (ลับ)" เท่านั้น) error ตัววัดรหัส · ข้อมูลทดสอบทั้งหมดเป็นของปลอม
const require = createRequire(import.meta.url);
const model = require("../../modules/itas-model.js");

const plain = (value) => JSON.parse(JSON.stringify(value));
const ID = "2a500000-0000-4000-8000-000000000001";
const STAMP = "2026-11-24T05:12:33.123456+00:00"; // มีไมโครวินาที: ต้องส่งกลับเป็นสตริงเดิม
const COMPUTER = {
  code: "COMPUTER", name: "เครื่องคอมพิวเตอร์", has_device_code: true, is_active: true, reg_prefix: "",
  fields: [
    { key: "cpu", label: "CPU", type: "text", secret: false, order: 1, max: 100 },
    { key: "ram_gb", label: "RAM (GB)", type: "number", secret: false, order: 2 },
    { key: "os_installed", label: "ติดตั้ง OS เมื่อ", type: "date", secret: false, order: 3 },
    { key: "kind", label: "ชนิด", type: "choice", secret: false, order: 4, choices: ["PC", "AIO"] },
    { key: "old_col", label: "คอลัมน์เก่า", type: "text", secret: false, order: 5, hidden: true },
    { key: "ip", label: "IP", type: "text", secret: true, order: 6 },
    { key: "license_os", label: "License OS", type: "text", secret: true, order: 7 },
  ],
};
const MOUSE = { code: "MOUSE", name: "เมาส์", has_device_code: false, is_active: true, fields: [] };
const ENVELOPE = { v: 1, n: "AAAAAAAAAAAAAAAA", c: "Y2lwaGVydGV4dC10ZXN0LW9ubHktMDAwMDAwMDA=" };
const ASSET = {
  id: ID, type_code: "COMPUTER", reg_no: "COM-001", device_code: "COM12", name: "เครื่องบัญชี", model: "Dell 3050", serial: "SN1", status: "in_use", host_code: null, slot: null, place: "ออฟฟิศ",
  install_date: "2025-03-05", record_date: null, purchase_date: null, vendor: null, price: 25000, tax_rate: 7, warranty_text: null, warranty_end: null, express_code: null, account_no: null, note: null,
  attrs: { cpu: "i5", ram_gb: 16, os_installed: "2025-03-01" }, secrets: { ip: ENVELOPE }, updated_at: STAMP,
};

/* ---------- วันที่ ---------- */
test("dates: type DD/MM/YYYY in Buddhist or Gregorian years, Thai digits, 8 digits; show as พ.ศ.", () => {
  for (const text of ["05/03/2566", "05/03/2023", "5-3-2566", "05.03.2566", "05 03 2566", "๐๕/๐๓/๒๕๖๖", "05032566", "2023-03-05"]) assert.equal(model.parseDateInput(text), "2023-03-05", text);
  for (const text of ["31/04/2566", "29/02/2566", "05/03/66", "abc", "", "05/13/2566"]) assert.equal(model.parseDateInput(text), null, text);
  assert.equal(model.formatDate("2023-03-05"), "05/03/2566");
  assert.equal(model.dateInputText("2025-03-05"), "05/03/2568");
  assert.equal(model.formatDateTime("2026-11-24T05:12:33.123456+00:00"), "24/11/2569 12:12", "เวลาไทย");
});

/* ---------- ฟอร์มจากนิยามช่อง ---------- */
test("form fields come from the type definition: hidden fields skipped, secret fields kept apart, device code only for types that have one", () => {
  assert.deepEqual(model.plainFields(COMPUTER).map((field) => field.key), ["cpu", "ram_gb", "os_installed", "kind"]);
  assert.deepEqual(model.secretFields(COMPUTER).map((field) => field.key), ["ip", "license_os"]);
  assert.ok(model.coreFieldsOf(COMPUTER).some((field) => field.key === "device_code"));
  assert.ok(!model.coreFieldsOf(MOUSE).some((field) => field.key === "device_code"));
  const empty = model.emptyFormValues(COMPUTER);
  assert.equal(empty.core.status, "in_use");
  assert.deepEqual(Object.keys(empty.attrs), ["cpu", "ram_gb", "os_installed", "kind"]);
  const values = model.formValuesFromAsset(ASSET, COMPUTER);
  assert.equal(values.core.install_date, "05/03/2568");
  assert.equal(values.core.price, "25000");
  assert.equal(values.attrs.ram_gb, "16");
  assert.equal(values.attrs.os_installed, "01/03/2568");
  assert.ok(!("ip" in values.attrs) && !JSON.stringify(values).includes("Y2lwaGVy"), "ไม่มีช่องลับ/ciphertext ในค่าฟอร์ม");
});

/* ---------- ตรวจค่า ---------- */
test("validation: needs one identifying field, dates/numbers/choices checked, host must differ from own code", () => {
  const blank = model.emptyFormValues(COMPUTER);
  assert.match(model.validateAsset({ type: COMPUTER, values: blank })[0].message, /อย่างน้อยหนึ่งอย่าง/);
  const good = model.formValuesFromAsset(ASSET, COMPUTER);
  assert.deepEqual(model.validateAsset({ type: COMPUTER, values: good }), []);
  const bad = structuredClone(good);
  bad.core.install_date = "31/02/2568";
  bad.core.price = "abc";
  bad.core.tax_rate = "101";
  bad.core.host_code = "com12"; // เทียบหลังแปลงเป็นตัวพิมพ์ใหญ่ ตรงกับรหัสของตัวเอง
  bad.attrs.kind = "TOWER";
  bad.attrs.ram_gb = "x";
  bad.core.name = "ก".repeat(201);
  const fields = model.validateAsset({ type: COMPUTER, values: bad }).map((error) => error.field);
  for (const field of ["install_date", "price", "tax_rate", "attrs.kind", "attrs.ram_gb", "name"]) assert.ok(fields.includes(field), field);
  const host = structuredClone(good);
  host.core.host_code = " com12 ";
  assert.deepEqual(model.validateAsset({ type: COMPUTER, values: host }).map((error) => error.field), ["host_code"]);
  const before1990 = structuredClone(good);
  before1990.core.purchase_date = "01/01/2532";
  assert.equal(model.validateAsset({ type: COMPUTER, values: before1990 })[0].field, "purchase_date");
  const price = structuredClone(good);
  price.core.price = "1,234.567";
  assert.equal(model.validateAsset({ type: COMPUTER, values: price })[0].field, "price");
  price.core.price = "1,234.5";
  assert.deepEqual(model.validateAsset({ type: COMPUTER, values: price }), []);
});

/* ---------- พารามิเตอร์ของ app_itas_save_asset ---------- */
test("create payload: type code, new id, only filled fields, dates in YYYY-MM-DD, numbers as numbers, codes upper-cased, no expected_updated_at", () => {
  const values = model.emptyFormValues(COMPUTER);
  Object.assign(values.core, { reg_no: " com-100 ", device_code: "com99", name: "เครื่องใหม่", install_date: "05/03/2568", price: "1,500" });
  Object.assign(values.attrs, { cpu: "i7", ram_gb: "8", os_installed: "" });
  const payload = model.buildSavePayload({ type: COMPUTER, values, assetId: ID, secretEnvelopes: { ip: ENVELOPE, license_os: null } });
  assert.deepEqual(plain(payload), {
    p_id: ID, p_type_code: "COMPUTER",
    p_data: { reg_no: "COM-100", device_code: "COM99", name: "เครื่องใหม่", status: "in_use", install_date: "2025-03-05", price: 1500 },
    p_attrs: { cpu: "i7", ram_gb: 8 },
    p_secrets: { ip: ENVELOPE },
    p_expected_updated_at: null,
  });
});

test("edit payload sends only what changed, the original updated_at string untouched (microseconds kept), and no type code", () => {
  const values = model.formValuesFromAsset(ASSET, COMPUTER);
  values.core.name = "เครื่องบัญชี 2";
  values.core.place = ""; // ล้างค่า
  values.attrs.cpu = "i7";
  const payload = model.buildSavePayload({ type: COMPUTER, original: ASSET, values });
  assert.deepEqual(plain(payload.p_data), { name: "เครื่องบัญชี 2", place: null });
  assert.deepEqual(plain(payload.p_attrs), { cpu: "i7" });
  assert.deepEqual(payload.p_secrets, {});
  assert.equal(payload.p_expected_updated_at, STAMP);
  assert.equal(payload.p_expected_updated_at, ASSET.updated_at);
  assert.ok(!("p_type_code" in payload));
  assert.equal(payload.p_id, ID);
  assert.ok(!JSON.stringify(payload).includes(".123Z"), "ไม่ผ่าน Date.toISOString");
  // ไม่แก้อะไรเลย = ว่าง
  assert.ok(model.payloadIsEmpty(model.buildSavePayload({ type: COMPUTER, original: ASSET, values: model.formValuesFromAsset(ASSET, COMPUTER) })));
});

test("a locked vault means no secret key is sent at all; an unlocked edit sends only the fields the user touched (null = delete)", () => {
  const values = model.formValuesFromAsset(ASSET, COMPUTER);
  const locked = model.buildSavePayload({ type: COMPUTER, original: ASSET, values, secretEnvelopes: {} });
  assert.deepEqual(locked.p_secrets, {});
  const touched = model.buildSavePayload({ type: COMPUTER, original: ASSET, values, secretEnvelopes: { license_os: ENVELOPE, ip: null, not_a_field: ENVELOPE } });
  assert.deepEqual(plain(touched.p_secrets), { license_os: ENVELOPE, ip: null }, "key ที่ไม่ใช่ช่องลับของชนิดนี้ถูกทิ้ง");
  assert.ok(!model.payloadIsEmpty(touched));
  // สร้างใหม่ไม่มีอะไรให้ลบ
  const create = model.buildSavePayload({ type: COMPUTER, values: Object.assign(model.emptyFormValues(COMPUTER), {}), assetId: ID, secretEnvelopes: { ip: null } });
  assert.deepEqual(create.p_secrets, {});
});

test("secret values never travel through the model: plaintext in values.attrs for a secret key is ignored, not forwarded", () => {
  const values = model.formValuesFromAsset(ASSET, COMPUTER);
  values.attrs.license_os = "PLAINTEXT-LICENSE-TEST";
  values.attrs.ip = "10.1.1.1";
  const payload = model.buildSavePayload({ type: COMPUTER, original: ASSET, values });
  assert.ok(!JSON.stringify(payload).includes("PLAINTEXT-LICENSE-TEST") && !JSON.stringify(payload).includes("10.1.1.1"));
  assert.ok(!("license_os" in payload.p_attrs) && !("ip" in payload.p_attrs));
});

/* ---------- ตาราง ---------- */
test("table columns: main columns + the first 3 non-secret type fields; secret and hidden fields never appear", () => {
  const keys = model.tableColumns(COMPUTER).map((column) => column.key);
  assert.deepEqual(keys, ["reg_no", "device_code", "name", "serial", "status", "host_code", "install_date", "attrs.cpu", "attrs.ram_gb", "attrs.os_installed"]);
  assert.ok(!model.tableColumns(MOUSE).some((column) => column.key === "device_code"));
  const [reg, , name] = model.tableColumns(COMPUTER);
  assert.equal(model.cellText(ASSET, reg), "COM-001");
  assert.equal(model.cellText(ASSET, name), "เครื่องบัญชี · Dell 3050");
  assert.equal(model.cellText(ASSET, model.tableColumns(COMPUTER).find((column) => column.key === "install_date")), "05/03/2568");
});

test("search matches many words across core + non-secret type fields (case-insensitive); status filter; secrets are not searchable", () => {
  const rows = [ASSET, { ...ASSET, id: "b", reg_no: "COM-002", name: "เครื่องขาย", status: "broken", attrs: { cpu: "Ryzen" } }, { ...ASSET, id: "c", reg_no: "COM-003", status: "retired", secrets: { ip: { ...ENVELOPE, c: "searchable-ciphertext" } } }];
  assert.equal(model.filterAssets(rows, { query: "dell i5" }).length, 2, "ทุกคำต้องเจอ");
  assert.deepEqual(model.filterAssets(rows, { query: "RYZEN" }).map((row) => row.id), ["b"]);
  assert.deepEqual(model.filterAssets(rows, { status: "broken" }).map((row) => row.id), ["b"]);
  assert.equal(model.filterAssets(rows, { status: "all" }).length, 3);
  assert.equal(model.filterAssets(rows, { query: "searchable-ciphertext" }).length, 0);
  assert.equal(model.filterAssets(null, {}).length, 0);
});

test("sorting is natural (COM2 before COM10), puts empty values last in both directions, and orders numbers/dates by value", () => {
  const columns = Object.fromEntries(model.tableColumns(COMPUTER).map((column) => [column.key, column]));
  const rows = [{ id: 1, reg_no: "COM10", attrs: { ram_gb: 16 }, install_date: "2025-01-02" }, { id: 2, reg_no: "COM2", attrs: { ram_gb: 8 }, install_date: null }, { id: 3, reg_no: null, attrs: { ram_gb: 128 }, install_date: "2024-12-31" }];
  assert.deepEqual(model.sortAssets(rows, columns.reg_no).map((row) => row.id), [2, 1, 3]);
  assert.deepEqual(model.sortAssets(rows, columns.reg_no, "descending").map((row) => row.id), [1, 2, 3]);
  assert.deepEqual(model.sortAssets(rows, columns["attrs.ram_gb"]).map((row) => row.id), [2, 1, 3]);
  assert.deepEqual(model.sortAssets(rows, columns.install_date).map((row) => row.id), [3, 1, 2]);
  assert.equal(model.countText(3, 3), "3 รายการ");
  assert.equal(model.countText(2, 3), "พบ 2 จาก 3 รายการ");
  assert.match(model.countText(2000, 2500, 2000), /โหลดมาแสดง 2000/);
});

/* ---------- ประวัติ ---------- */
test("history view lists changed fields; secret fields show only 'changed (secret)' and never ciphertext", () => {
  const before = { ...ASSET, secrets: { ip: ENVELOPE } };
  const after = { ...ASSET, name: "ชื่อใหม่", status: "broken", attrs: { ...ASSET.attrs, cpu: "i9" }, secrets: { ip: { ...ENVELOPE, c: "T1RIRVItQ0lQSEVSVEVYVA==" }, license_os: ENVELOPE }, updated_at: "2026-11-25T00:00:00.000000+00:00" };
  const view = model.historyView({
    log: [
      { id: 2, action: "updated", actor_employee_no: "IT3462", actor_full_name: "สุริยา", old_values: before, new_values: after, created_at: "2026-11-25T01:00:00+00:00" },
      { id: 1, action: "created", actor_employee_no: "IT3462", actor_full_name: "สุริยา", old_values: null, new_values: before, created_at: "2026-11-24T01:00:00+00:00" },
    ],
    moves: [{ id: 9, from_host: null, to_host: "COM12", from_slot: null, to_slot: "RAM1", from_status: "in_use", to_status: "broken", actor_employee_no: "IT3462", actor_full_name: "สุริยา", created_at: "2026-11-25T01:00:00+00:00" }],
  }, COMPUTER);
  const [update, created] = view.log;
  assert.equal(update.actionLabel, "แก้ไข");
  assert.equal(created.created, true);
  const byLabel = Object.fromEntries(update.changes.map((change) => [change.label, change]));
  assert.deepEqual([byLabel["ชื่อ"].from, byLabel["ชื่อ"].to], ["เครื่องบัญชี", "ชื่อใหม่"]);
  assert.deepEqual([byLabel["สถานะ"].from, byLabel["สถานะ"].to], ["ใช้งาน", "ชำรุด"]);
  assert.deepEqual([byLabel.CPU.from, byLabel.CPU.to], ["i5", "i9"]);
  assert.equal(byLabel.IP.to, "เปลี่ยนค่า (ลับ)");
  assert.equal(byLabel["License OS"].to, "ตั้งค่า (ลับ)");
  assert.ok(!("updated_at" in byLabel) && !byLabel["วันที่ติดตั้ง"]);
  const text = JSON.stringify(view);
  assert.ok(!text.includes(ENVELOPE.c) && !text.includes("T1RIRVItQ0lQSEVSVEVYVA"), "ไม่มี ciphertext ในประวัติที่แสดง");
  assert.deepEqual(view.moves[0].parts, ["ติดตั้งที่: — → COM12", "ช่อง/ตำแหน่ง: — → RAM1", "สถานะ: ใช้งาน → ชำรุด"]);
});

/* ---------- รหัสตู้เซฟ ---------- */
test("password strength: under 14 characters is not ok; long multi-word phrases rate higher; repeated characters are flagged", () => {
  assert.equal(model.passwordStrength("").label, "");
  assert.equal(model.passwordStrength("short").ok, false);
  assert.match(model.passwordStrength("short").label, /อีก 9 ตัวอักษร/);
  // ตัวอักษรไม่ซ้ำน้อยกว่า 6 แบบ = ไม่ผ่าน (ตัววัดสอดคล้องกับกฎที่ตู้เซฟบล็อกจริง)
  assert.equal(model.passwordStrength("a".repeat(20)).ok, false);
  assert.equal(model.passwordStrength("a".repeat(20)).level, 0);
  assert.equal(model.passwordStrength("kv9#Xq2!mZ7pLw").ok, true);
  assert.equal(model.passwordStrength("ม้าลาย กินหญ้า ริมน้ำ ยามเช้า").level, 3);
  assert.ok(model.passwordStrength("blue horse eats apples").level >= 2);
  assert.match(model.PASSWORD_ADVICE, /ห้ามใช้รหัสเดียวกับรหัสเข้าสู่ระบบ/);
});

/* ---------- error ---------- */
test("describeError: conflict, access, session, missing, vault and database messages", () => {
  const conflict = model.describeError({ code: "40001", message: "ข้อมูลอุปกรณ์นี้ถูกแก้ไขไปแล้ว" }, { write: true });
  assert.equal(conflict.kind, "conflict");
  assert.match(conflict.message, /โหลดข้อมูลล่าสุด/);
  assert.match(conflict.message, /ยังอยู่ในฟอร์ม/, "ไม่ทิ้งสิ่งที่พิมพ์เงียบ ๆ");
  assert.equal(model.describeError({ code: "42501", message: "เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้" }).kind, "access");
  assert.equal(model.describeError({ code: "23514", message: "เลขทะเบียน COM-1 ซ้ำกับอุปกรณ์อื่น" }).forwarded, true);
  assert.equal(model.describeError({ code: "PGRST301", message: "JWT expired" }).kind, "session");
  assert.equal(model.describeError({ code: "PGRST202", message: "x" }).kind, "missing");
  assert.equal(model.describeError({ code: "", message: "Failed to fetch" }, { write: true }).kind, "unknown");
  assert.match(model.describeError({ code: "", message: "Failed to fetch" }, { write: true }).message, /ผลไม่แน่ชัด/);
  assert.equal(model.describeError({ code: "XX000", message: "internal english" }).message, "ทำรายการไม่สำเร็จ กรุณาลองใหม่ ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ");
  const vault = model.describeError({ name: "VaultError", reason: "WRONG_SECRET", message: "รหัสไม่ถูกต้อง" });
  assert.deepEqual([vault.kind, vault.message], ["vault", "รหัสไม่ถูกต้อง"]);
  assert.equal(model.isAlreadyExists({ code: "23514", message: "อุปกรณ์นี้มีอยู่แล้ว กรุณาโหลดข้อมูลล่าสุด" }), true);
  assert.equal(model.isAlreadyExists({ code: "23514", message: "ซ้ำ" }), false);
});

test("routes and version metadata", () => {
  assert.equal(model.assetsUrl(), "#/office?module=assets");
  assert.equal(model.readView(new URLSearchParams("module=assets")), "main");
  assert.equal(model.readView(new URLSearchParams("module=assets&view=other")), null);
  assert.equal(model.MODULE_VERSION, "1.00");
  assert.equal(model.IN_DEVELOPMENT, true);
  assert.equal(model.ASSET_CODE, "IT_ASSET_REGISTER");
  assert.ok(model.isUuid(ID) && !model.isUuid("x"));
});
