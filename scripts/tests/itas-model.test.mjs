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
  assert.equal(model.MODULE_VERSION, "1.01");
  assert.equal(model.IN_DEVELOPMENT, true);
  assert.equal(model.ASSET_CODE, "IT_ASSET_REGISTER");
  assert.ok(model.isUuid(ID) && !model.isUuid("x"));
});

/* ---------- หน้าทะเบียนรวม: ชิปชนิด ตารางทั้งหมด ค้นหาข้ามชนิด ---------- */
const CHIP_TYPES = [
  { code: "COMPUTER", name: "เครื่องคอมพิวเตอร์", asset_count: 5 },
  { code: "MOUSE", name: "เมาส์", asset_count: 0 },
  { code: "MONITOR", name: "จอภาพ", asset_count: 3 },
  { code: "OLD", name: "ชนิดเก่า", asset_count: 0, is_active: false },
];
const ROWS = [
  { id: "1", type_code: "COMPUTER", reg_no: "COM-2", device_code: "COM2", name: "เครื่องบัญชี", model: "Dell 3050", status: "in_use", host_code: null, place: "สำนักงาน", attrs: { user_name: "สมหญิง", cpu: "i5" }, secrets: { ip: ENVELOPE } },
  { id: "2", type_code: "MONITOR", reg_no: "MNT-1", device_code: "MNT1", name: "จอ 24 นิ้ว", model: "LG", status: "spare", host_code: "COM2", place: "โรงงาน", attrs: {}, secrets: {} },
  { id: "3", type_code: "COMPUTER", reg_no: "COM-10", device_code: "COM10", name: "เครื่องขาย", model: "HP", status: "broken", host_code: null, place: null, attrs: { user_name: "สมชาย" }, secrets: {} },
];

test("type chips: types that hold equipment come first (database order kept), empty types are grouped apart", () => {
  const { used, empty } = model.typeChipGroups(CHIP_TYPES);
  assert.deepEqual(used.map((type) => type.code), ["COMPUTER", "MONITOR"]);
  assert.deepEqual(empty.map((type) => type.code), ["MOUSE", "OLD"]);
  assert.deepEqual(model.typeChipGroups(null), { used: [], empty: [] });
});

test("all-types table: shared columns, the type name is shown but sorted by the database type order, 'user' falls back from user_name to host_code", () => {
  const columns = model.allColumns(CHIP_TYPES);
  assert.deepEqual(columns.map((column) => column.key), ["reg_no", "device_code", "type", "name", "user", "place", "status"]);
  const byKey = Object.fromEntries(columns.map((column) => [column.key, column]));
  assert.equal(model.cellText(ROWS[0], byKey.type), "เครื่องคอมพิวเตอร์");
  assert.equal(model.cellText(ROWS[0], byKey.user), "สมหญิง", "ผู้ใช้จากช่อง user_name");
  assert.equal(model.cellText(ROWS[1], byKey.user), "COM2", "ชนิดที่ไม่มี user_name ใช้ ติดตั้งที่");
  assert.equal(model.cellText(ROWS[0], byKey.name), "เครื่องบัญชี · Dell 3050");
  // ชนิดเรียงตามลำดับของฐานข้อมูล (COMPUTER ก่อน MONITOR) ไม่ใช่ตัวอักษรไทย (จอภาพ มาก่อน เครื่อง)
  assert.deepEqual(model.sortAssets(ROWS, byKey.type).map((row) => row.id), ["1", "3", "2"]);
  assert.deepEqual(model.sortAssets(ROWS, byKey.type, "descending").map((row) => row.id), ["2", "1", "3"]);
  assert.deepEqual(model.sortAssets(ROWS, byKey.reg_no).map((row) => row.id), ["1", "3", "2"], "COM-2 ก่อน COM-10 แบบ natural");
});

test("search works across all types on non-secret fields only: reg no, code, name, brand/model, user, place, type name; secrets are never searchable", () => {
  const typeNames = Object.fromEntries(CHIP_TYPES.map((type) => [type.code, type.name]));
  const find = (query, extra = {}) => model.filterAssets(ROWS, { query, typeNames, ...extra }).map((row) => row.id);
  assert.deepEqual(find("dell"), ["1"], "รุ่น/ยี่ห้อ ไม่สนตัวพิมพ์");
  assert.deepEqual(find("สมชาย"), ["3"], "ผู้ใช้");
  assert.deepEqual(find("โรงงาน"), ["2"], "สถานที่");
  assert.deepEqual(find("com2"), ["1", "2"], "รหัสเครื่อง และ ติดตั้งที่");
  assert.deepEqual(find("จอภาพ"), ["2"], "ชื่อชนิด");
  assert.deepEqual(find("เครื่อง สมหญิง"), ["1"], "หลายคำ ทุกคำต้องเจอ");
  assert.deepEqual(find(""), ["1", "2", "3"]);
  assert.deepEqual(find("", { typeCode: "COMPUTER" }), ["1", "3"], "ชิปชนิด");
  assert.deepEqual(find("", { status: "spare" }), ["2"]);
  assert.deepEqual(find(ENVELOPE.c), [], "ciphertext ของช่องลับไม่เข้าไปในข้อความค้นหา");
});

test("main form fields: code(s), name, brand/model, user, status; the user is user_name when the type has it, otherwise the install host; the rest is folded", () => {
  assert.deepEqual(model.primaryFieldNames(COMPUTER), ["reg_no", "device_code", "name", "model", "host_code", "status"]);
  assert.deepEqual(model.primaryFieldNames(MOUSE), ["reg_no", "name", "model", "host_code", "status"], "ไม่มีรหัสอุปกรณ์ในชนิดนี้");
  const withUser = { ...COMPUTER, fields: [{ key: "user_name", label: "ชื่อผู้ใช้", type: "text", secret: false, order: 0 }, ...COMPUTER.fields] };
  assert.equal(model.userFieldName(withUser), "attrs.user_name");
  assert.ok(model.isPrimaryField(withUser, "attrs.user_name") && !model.isPrimaryField(withUser, "host_code"));
  const hiddenUser = { ...COMPUTER, fields: [{ key: "user_name", label: "ชื่อผู้ใช้", type: "text", secret: false, order: 0, hidden: true }] };
  assert.equal(model.userFieldName(hiddenUser), "host_code", "ช่องที่ซ่อนไม่นับ");
  assert.equal(model.CORE_FIELDS.find((field) => field.key === "model").label, "ยี่ห้อ / รุ่น");
  // เปิดรายละเอียดเพิ่มเติมเมื่อช่องที่พับมีค่า (แก้ของเดิม) · ช่องหลักอย่างเดียวไม่นับ
  assert.equal(model.extraFieldsHaveValues(COMPUTER, model.emptyFormValues(COMPUTER)), false);
  const main = model.emptyFormValues(COMPUTER);
  Object.assign(main.core, { reg_no: "COM-1", name: "x", model: "Dell", host_code: "COM2" });
  assert.equal(model.extraFieldsHaveValues(COMPUTER, main), false);
  const place = structuredClone(main); place.core.place = "ออฟฟิศ";
  assert.equal(model.extraFieldsHaveValues(COMPUTER, place), true);
  const cpu = structuredClone(main); cpu.attrs.cpu = "i5";
  assert.equal(model.extraFieldsHaveValues(COMPUTER, cpu), true);
  assert.equal(model.extraFieldsHaveValues(COMPUTER, model.formValuesFromAsset(ASSET, COMPUTER)), true);
  assert.equal(model.extraFieldsHaveValues(COMPUTER, null), false);
  assert.equal(model.errorsInExtraFields(COMPUTER, [{ field: "reg_no" }, { field: "status" }]), false);
  assert.equal(model.errorsInExtraFields(COMPUTER, [{ field: "reg_no" }, { field: "price" }]), true);
  assert.equal(model.errorsInExtraFields(COMPUTER, [{ field: "attrs.cpu" }]), true);
});

test("copy as a new device: every non-secret field is copied except the ones that must be unique (reg no, device code, serial, accounting no, serial-like attrs); status resets; secrets are never in the values", () => {
  const withSerial = { ...COMPUTER, fields: [...COMPUTER.fields, { key: "battery_serial", label: "Battery Serial", type: "text", secret: false, order: 8 }, { key: "doc_code", label: "รหัสเอกสาร", type: "text", secret: false, order: 9 }] };
  const source = { ...ASSET, account_no: "ACC-9", status: "retired", attrs: { ...ASSET.attrs, battery_serial: "B1", doc_code: "D1" }, secrets: { ip: ENVELOPE, license_os: ENVELOPE } };
  const { values, skipped } = model.copyValuesFromAsset(source, withSerial);
  assert.equal(values.core.reg_no, "");
  assert.equal(values.core.device_code, "");
  assert.equal(values.core.serial, "");
  assert.equal(values.core.account_no, "");
  assert.equal(values.attrs.battery_serial, "");
  assert.equal(values.attrs.doc_code, "");
  assert.deepEqual(skipped, ["เลขทะเบียน", "รหัสอุปกรณ์", "Serial", "เลขทะเบียนทรัพย์สินทางบัญชี", "Battery Serial", "รหัสเอกสาร"]);
  assert.equal(values.core.name, "เครื่องบัญชี");
  assert.equal(values.core.model, "Dell 3050");
  assert.equal(values.core.place, "ออฟฟิศ");
  assert.equal(values.core.install_date, "05/03/2568");
  assert.equal(values.core.price, "25000");
  assert.equal(values.attrs.cpu, "i5");
  assert.equal(values.core.status, "in_use", "เครื่องใหม่เริ่มที่ ใช้งาน แม้ต้นฉบับยกเลิกแล้ว");
  assert.ok(!JSON.stringify(values).includes(ENVELOPE.c) && !("ip" in values.attrs) && !("license_os" in values.attrs), "ไม่คัดลอกช่องลับ");
  assert.equal(source.reg_no, "COM-001", "ไม่แตะต้นฉบับ");
  assert.deepEqual(model.copyValuesFromAsset({ ...ASSET, serial: null, reg_no: null, device_code: null }, COMPUTER).skipped, [], "ช่องที่ต้นฉบับไม่มีค่าไม่ต้องบอกว่าเว้นว่าง");
});

test("suggestions: from values already entered in the same type, most frequent first, only plain text fields, never secrets, bounded", () => {
  const rows = [
    { type_code: "COMPUTER", model: "Dell 3050", place: "สำนักงาน", host_code: null, vendor: "ร้าน A", attrs: { cpu: "i5", ram_gb: 8, os_installed: "2025-03-01", kind: "PC" }, secrets: { ip: ENVELOPE } },
    { type_code: "COMPUTER", model: "HP 400", place: "โรงงาน", host_code: "COM1", vendor: null, attrs: { cpu: "i5" }, secrets: {} },
    { type_code: "COMPUTER", model: "Dell 3050", place: "สำนักงาน", host_code: "COM1", vendor: "ร้าน A", attrs: { cpu: "i7" }, secrets: {} },
    { type_code: "COMPUTER", model: "Dell 3050", place: "  ", host_code: "", vendor: "x".repeat(81), attrs: { cpu: "" }, secrets: {} },
    { type_code: "MOUSE", model: "Logitech", place: "โรงงาน", attrs: {}, secrets: {} },
  ];
  const s = model.suggestionsFor(rows, COMPUTER);
  assert.deepEqual(s.core.model, ["Dell 3050", "HP 400"], "ความถี่มากก่อน");
  assert.deepEqual(s.core.place, ["สำนักงาน", "โรงงาน"]);
  assert.deepEqual(s.core.host_code, ["COM1"]);
  assert.deepEqual(s.core.vendor, ["ร้าน A"], "ค่ายาวเกิน 80 ตัวอักษรไม่แนะนำ");
  assert.deepEqual(s.attrs.cpu, ["i5", "i7"]);
  assert.ok(!("ram_gb" in s.attrs) && !("os_installed" in s.attrs) && !("kind" in s.attrs), "เฉพาะช่องข้อความ ไม่ใช่ตัวเลข/วันที่/ตัวเลือก");
  assert.ok(!("ip" in s.attrs) && !JSON.stringify(s).includes(ENVELOPE.c), "ช่องลับไม่เข้าคำแนะนำ");
  assert.deepEqual(model.suggestionsFor(rows, MOUSE).core, { model: ["Logitech"], place: ["โรงงาน"] }, "แยกตามชนิด ไม่ปนข้ามชนิด");
  assert.deepEqual(model.suggestionsFor([], COMPUTER), { core: {}, attrs: {} });
  const many = Array.from({ length: 100 }, (_, index) => ({ type_code: "MOUSE", model: `รุ่น ${index}`, attrs: {} }));
  assert.equal(model.suggestionsFor(many, MOUSE).core.model.length, model.MAX_SUGGESTIONS);
});

test("remembered values: only brand/model and place per type (+ last type), sanitised on read, never anything else", () => {
  const values = { core: { model: " Dell 3050 ", place: "สำนักงาน", serial: "SN9", reg_no: "COM-1", price: "100" }, attrs: { cpu: "i5", ip: "10.1.1.1" } };
  const memory = model.rememberAdded(model.parseMemory(""), "COMPUTER", values);
  assert.deepEqual(plain(memory), { lastType: "COMPUTER", types: { COMPUTER: { model: "Dell 3050", place: "สำนักงาน" } } });
  const text = model.serializeMemory(memory);
  for (const secretish of ["SN9", "COM-1", "10.1.1.1", "i5", "100"]) assert.ok(!text.includes(secretish), `ไม่เก็บ ${secretish}`);
  assert.deepEqual(plain(model.parseMemory(text)), plain(memory));
  // ชนิดอื่นไม่ทับกัน · ชนิดเดียวกันครั้งใหม่ทับครั้งเก่า
  const next = model.rememberAdded(memory, "MOUSE", { core: { model: "Logitech", place: "" } });
  assert.deepEqual(plain(next.types), { COMPUTER: { model: "Dell 3050", place: "สำนักงาน" }, MOUSE: { model: "Logitech" } });
  assert.equal(next.lastType, "MOUSE");
  assert.deepEqual(plain(model.rememberAdded(next, "MOUSE", { core: {} }).types), { COMPUTER: { model: "Dell 3050", place: "สำนักงาน" } }, "ครั้งล่าสุดไม่มีค่า = ลืมของชนิดนั้น");
  // ข้อความที่เสีย/ถูกแก้ไม่ทำให้พัง และไม่ยอมรับคีย์แปลก ๆ
  for (const bad of [null, "", "{", "[]", "123", '{"types":[]}']) assert.deepEqual(plain(model.parseMemory(bad)), { lastType: "", types: {} }, String(bad));
  const hostile = model.parseMemory(JSON.stringify({ lastType: "bad code", types: { COMPUTER: { model: "ok", ip: "1.2.3.4", place: 5, serial: "S" }, "../x": { model: "y" }, MOUSE: { model: "m".repeat(201) } } }));
  assert.deepEqual(plain(hostile), { lastType: "", types: { COMPUTER: { model: "ok" } } });
  assert.deepEqual(plain(model.forgetType(memory, "COMPUTER").types), {});
  assert.equal(model.forgetType(memory, "COMPUTER").lastType, "COMPUTER");
});

test("applying remembered values fills only the type's own empty brand/place fields and reports what it filled; typing wins over it when changing type", () => {
  const memory = model.rememberAdded(model.parseMemory(""), "COMPUTER", { core: { model: "Dell", place: "สำนักงาน" } });
  const { values, applied } = model.applyRemembered(COMPUTER, model.emptyFormValues(COMPUTER), memory);
  assert.equal(values.core.model, "Dell");
  assert.equal(values.core.place, "สำนักงาน");
  assert.deepEqual(applied.map((item) => [item.key, item.label, item.value]), [["model", "ยี่ห้อ / รุ่น", "Dell"], ["place", "สถานที่", "สำนักงาน"]]);
  assert.equal(values.core.reg_no, "");
  assert.deepEqual(model.applyRemembered(MOUSE, model.emptyFormValues(MOUSE), memory).applied, [], "ชนิดอื่นไม่ได้รับ");
  const typedAlready = model.emptyFormValues(COMPUTER); typedAlready.core.model = "HP";
  assert.equal(model.applyRemembered(COMPUTER, typedAlready, memory).values.core.model, "HP", "ช่องที่มีค่าอยู่ไม่ถูกทับ");
  // ค่าที่ระบบเติมให้ไม่นับเป็นที่พิมพ์เอง
  const initial = values; const current = structuredClone(values); current.core.name = "ชื่อใหม่"; current.attrs.cpu = "i7";
  assert.deepEqual(plain(model.typedSince(current, initial)), { core: { name: "ชื่อใหม่" }, attrs: { cpu: "i7" } });
});

test("batch lines: one device per line, blank lines skipped, two-column lines split on tab or comma, duplicates inside the batch flagged, bounded", () => {
  const one = model.parseBatchLines("SN001\n\n  SN002  \r\nSN001\nsn002", ["serial"]);
  assert.deepEqual(one.items.map((item) => [item.line, item.values.serial]), [[1, "SN001"], [3, "SN002"]]);
  assert.deepEqual(one.errors.map((error) => error.message), ["บรรทัด 4: Serial ซ้ำกับบรรทัด 1", "บรรทัด 5: Serial ซ้ำกับบรรทัด 3"]);
  const two = model.parseBatchLines("COM01, SN1\nCOM02\tSN2\nCOM03\ncom01, SN9\nCOM05, ", ["device_code", "serial"]);
  assert.deepEqual(two.items.map((item) => [item.values.device_code, item.values.serial]), [["COM01", "SN1"], ["COM02", "SN2"]]);
  assert.deepEqual(two.errors.map((error) => error.line), [3, 4, 5]);
  assert.match(two.errors[0].message, /ต้องมี 2 ค่า/);
  assert.match(two.errors[1].message, /รหัสอุปกรณ์ ซ้ำกับบรรทัด 1/, "รหัสเทียบแบบไม่สนตัวพิมพ์เล็กใหญ่");
  const huge = model.parseBatchLines(Array.from({ length: 51 }, (_, index) => `SN${index}`).join("\n"), ["serial"]);
  assert.equal(huge.errors[0].line, 0);
  assert.match(huge.errors[0].message, /ไม่เกิน 50/);
  assert.deepEqual(model.parseBatchLines("", ["serial"]), { items: [], errors: [] });
});

test("batch options follow the type: device code choices only when the type has one", () => {
  assert.deepEqual(model.batchColumnOptions(COMPUTER).map((option) => option.value), ["serial", "reg_no", "device_code", "device_code,serial", "reg_no,serial"]);
  assert.deepEqual(model.batchColumnOptions(MOUSE).map((option) => option.value), ["serial", "reg_no", "reg_no,serial"]);
  assert.equal(model.batchOptionOf(MOUSE, "device_code").value, "serial", "ตัวเลือกที่ชนิดนี้ไม่มี = ใช้ตัวแรก");
});

test("batch plan: shared fields come from the form, the per-line fields from the list; unique fields in the form must be empty; one bad line blocks the whole batch", () => {
  const base = model.emptyFormValues(COMPUTER);
  Object.assign(base.core, { name: "เครื่องออฟฟิศ", model: "Dell 3050", place: "สำนักงาน", host_code: "" });
  base.attrs.cpu = "i5";
  const ok = model.buildBatchPlan({ type: COMPUTER, base, columns: "device_code,serial", text: "COM01, SN1\ncom02, SN2" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.items.map((item) => item.label), ["COM01", "com02"]);
  assert.equal(ok.items[1].values.core.device_code, "com02");
  assert.equal(ok.items[1].values.core.name, "เครื่องออฟฟิศ");
  assert.equal(ok.items[0].values.attrs.cpu, "i5");
  const payload = model.buildSavePayload({ type: COMPUTER, values: ok.items[1].values, assetId: ID });
  assert.deepEqual(plain(payload.p_data), { device_code: "COM02", serial: "SN2", name: "เครื่องออฟฟิศ", model: "Dell 3050", status: "in_use", place: "สำนักงาน" });
  assert.deepEqual(plain(payload.p_secrets), {}, "ไม่มีช่องลับในโหมดนี้");
  assert.equal(payload.p_type_code, "COMPUTER");
  // เลขทะเบียน/รหัสอุปกรณ์/ช่องที่ใช้ในรายการ ต้องเว้นว่างในฟอร์ม
  const clash = structuredClone(base); clash.core.reg_no = "COM-1"; clash.core.serial = "SN-X";
  const bad = model.buildBatchPlan({ type: COMPUTER, base: clash, columns: "serial", text: "SN1" });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.fieldErrors.map((error) => error.field).sort(), ["reg_no", "serial"]);
  // ค่าผิดในบรรทัดเดียว = ทั้งชุดไม่ผ่าน และบอกเลขบรรทัด · ข้อผิดของฟอร์มร่วมรายงานครั้งเดียว
  const long = model.buildBatchPlan({ type: COMPUTER, base, columns: "serial", text: `SN1\n${"x".repeat(201)}\nSN3` });
  assert.equal(long.ok, false);
  assert.deepEqual(long.lineErrors.map((error) => error.line), [2]);
  const price = structuredClone(base); price.core.price = "abc";
  const shared = model.buildBatchPlan({ type: COMPUTER, base: price, columns: "serial", text: "A\nB\nC" });
  assert.deepEqual(shared.fieldErrors.map((error) => error.field), ["price"]);
  assert.equal(shared.lineErrors.length, 0);
  assert.equal(model.buildBatchPlan({ type: COMPUTER, base, columns: "serial", text: "  \n " }).ok, false, "ไม่มีรายการ");
});

test("changing the type inside the add form carries over only typed values whose field exists in the new type", () => {
  const carried = { core: { reg_no: "X1", device_code: "COM9", name: "ชื่อ", model: "", status: "spare" }, attrs: { cpu: "i7", ram_gb: "", kind: "PC" } };
  const next = model.carryOver(MOUSE, carried);
  assert.deepEqual(plain(next), { core: { reg_no: "X1", name: "ชื่อ", status: "spare" }, attrs: {} }, "เมาส์ไม่มีรหัสอุปกรณ์/ช่องเฉพาะ · ค่าว่างไม่ถูกยก");
  const back = model.carryOver(COMPUTER, carried);
  assert.equal(back.core.device_code, "COM9");
  assert.deepEqual(plain(back.attrs), { cpu: "i7", kind: "PC" });
  assert.ok(!JSON.stringify(model.carryOver(COMPUTER, { core: {}, attrs: { ip: "10.0.0.1" } })).includes("10.0.0.1"), "ช่องลับไม่ใช่ช่องธรรมดา จึงไม่ถูกยก");
});
