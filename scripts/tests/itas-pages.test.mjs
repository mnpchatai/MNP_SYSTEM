import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// HTML ของทะเบียนอุปกรณ์ IT (modules/itas-pages.js): หัว/แถบตู้เซฟ/ฟอร์มตู้เซฟ/ตาราง/ฟอร์มอุปกรณ์/ช่องลับ/ประวัติ · escape ทุกค่า · ช่องลับถูก mask · ไม่มี plaintext/ciphertext ในหน้า
const require = createRequire(import.meta.url);
globalThis.MNP_UI_ICONS = require("../../modules/ui-icons.js");
globalThis.MNP_ITAS_MODEL = require("../../modules/itas-model.js");
const model = globalThis.MNP_ITAS_MODEL;
const pages = require("../../modules/itas-pages.js");

const count = (text, pattern) => (text.match(pattern) ?? []).length;
const visibleText = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const XSS = '<img src=x onerror="alert(1)">';
const ID = "2a500000-0000-4000-8000-000000000001";
const CIPHER = "Y2lwaGVydGV4dC10ZXN0LW9ubHktMDAwMDAwMDA=";
const TYPE = {
  code: "COMPUTER", name: "เครื่องคอมพิวเตอร์", has_device_code: true, is_active: true,
  fields: [
    { key: "cpu", label: "CPU", type: "text", secret: false, order: 1, max: 100 },
    { key: "kind", label: "ชนิด", type: "choice", secret: false, order: 2, choices: ["PC", "AIO"] },
    { key: "installed", label: "ติดตั้งเมื่อ", type: "date", secret: false, order: 3 },
    { key: "ip", label: "IP", type: "text", secret: true, order: 4 },
    { key: "license_os", label: "License OS", type: "text", secret: true, order: 5 },
  ],
};
const ASSET = { id: ID, type_code: "COMPUTER", reg_no: "COM-001", device_code: "COM12", name: `เครื่อง ${XSS}`, model: "Dell", serial: "SN1", status: "in_use", host_code: null, install_date: "2025-03-05", attrs: { cpu: XSS, kind: "PC" }, secrets: { ip: { v: 1, n: "AAAAAAAAAAAAAAAA", c: CIPHER } }, updated_at: "2026-11-24T05:12:33.123456+00:00" };

test("head: one h1, back link to IT SUPPORT, test tag only in test mode, dev notice + version tag", () => {
  const html = pages.page(pages.head({ isTest: false }));
  assert.equal(count(html, /<h1>/g), 1);
  assert.match(html, /<h1>ทะเบียนอุปกรณ์ IT<\/h1>/);
  assert.match(html, /href="#\/office\?module=it-support">‹ IT SUPPORT</);
  assert.doesNotMatch(html, /itas-test-tag/);
  assert.match(pages.head({ isTest: true }), /<span class="badge itas-test-tag"[^>]*>ทดสอบ<\/span>/);
  assert.match(html, /กำลังพัฒนาและทดสอบ ยังไม่เปิดใช้งานจริง/);
  assert.match(html, /<p class="itas-version no-print"[^>]*>V1\.00<\/p>/);
});

test("vault bar: shows state for every status with the right buttons; test vault is labelled", () => {
  const uninit = pages.vaultBar({ status: "uninitialized", isTest: false });
  assert.match(uninit, /ยังไม่ตั้ง/);
  assert.match(uninit, /id="itas-vault-setup"/);
  const locked = pages.vaultBar({ status: "locked", isTest: false });
  assert.match(locked, /ล็อก/);
  assert.match(locked, /id="itas-vault-unlock"[^>]*>ปลดล็อกตู้เซฟ</);
  assert.doesNotMatch(locked, /itas-vault-lock"/);
  const unlocked = pages.vaultBar({ status: "unlocked", isTest: true });
  assert.match(unlocked, /ตู้เซฟทดสอบ:/);
  assert.match(unlocked, /ปลดล็อกอยู่/);
  assert.match(unlocked, /id="itas-vault-lock"/);
  assert.match(unlocked, /id="itas-vault-change"/);
  assert.match(unlocked, /id="itas-vault-recovery"/);
  assert.match(unlocked, /10 นาที/);
  assert.match(pages.vaultBar({ status: "unknown" }), /กำลังตรวจสอบ/);
  assert.match(pages.vaultBar({ status: "locked" }), /role="status"/);
});

// ทุกช่องรหัส/รหัสกู้คืน/ค่าลับต้องมีชุดแอตทริบิวต์กัน autofill ตัวจัดการรหัสผ่าน และการแก้คำอัตโนมัติ
const NO_AUTOFILL_ATTRIBUTES = [/autocomplete="off"/, /data-lpignore="true"/, /data-1p-ignore/, /data-form-type="other"/, /autocorrect="off"/, /spellcheck="false"/, /autocapitalize="(off|characters)"/];
const assertNoAutofill = (input, label) => { for (const pattern of NO_AUTOFILL_ATTRIBUTES) assert.match(input, pattern, `${label}: ${pattern}`); };
test("vault forms: every secret/recovery input blocks autofill, password managers and autocorrect; passwords start as type=password; forms are autocomplete=off; the recovery code has no copy button", () => {
  const forms = [pages.vaultSetupForm(), pages.unlockForm(), pages.forgotForm(), pages.changeForm(), pages.newRecoveryForm(), pages.recoveryShow({ code: "ABCD-EFGH", mode: "setup" })];
  let inspected = 0;
  for (const html of forms) {
    for (const input of html.match(/<input[^>]*data-vault-input[^>]*>/g) ?? []) {
      inspected += 1;
      if (/name="recovery"|name="typed"/.test(input)) assert.match(input, /type="text"/);
      else { assert.match(input, /type="password"/); assert.match(input, /data-mask/, "module เปลี่ยนเป็น text + CSS mask เฉพาะช่องที่มี data-mask"); }
      assertNoAutofill(input, input.slice(0, 60));
      assert.doesNotMatch(input, /autocomplete="(new|current)-password"/, "ไม่ขอให้ตัวจัดการรหัสผ่านเติม/เสนอรหัสใหม่");
      assert.doesNotMatch(input, /\svalue=/);
    }
    for (const form of html.match(/<form [^>]*>/g) ?? []) assert.match(form, /autocomplete="off"/);
    assert.match(html, /id="itas-vault-message" role="status"/);
  }
  assert.ok(inspected >= 9, "ตรวจครบทุกช่องของทุกฟอร์ม");
  // ช่องค่าลับในฟอร์มอุปกรณ์ก็ชุดเดียวกัน
  const secretInputs = pages.secretsSection({ fields: model.secretFields(TYPE), asset: ASSET, vaultStatus: "unlocked" }).match(/<input[^>]*data-secret-input[^>]*>/g) ?? [];
  assert.equal(secretInputs.length, 2);
  for (const input of secretInputs) { assertNoAutofill(input, "secret"); assert.match(input, /data-mask/); }
  assert.match(pages.assetForm({ mode: "add", type: TYPE, values: model.emptyFormValues(TYPE), vaultStatus: "locked" }), /<form id="itas-form" novalidate autocomplete="off">/);
  assert.match(pages.vaultSetupForm(), new RegExp(`อย่างน้อย ${model.MIN_PASSWORD_LENGTH} ตัวอักษร`));
  assert.match(pages.vaultSetupForm(), /ห้ามใช้รหัสเดียวกับรหัสเข้าสู่ระบบ/);
  assert.match(pages.vaultSetupForm(), /id="itas-vault-strength"/);
  assert.match(pages.vaultSetupForm({ isTest: true }), /ตั้งตู้เซฟทดสอบ/);
  assert.match(pages.unlockForm(), /id="itas-vault-forgot"/);
  const show = pages.recoveryShow({ code: "ABCD-EFGH", mode: "setup" });
  assert.match(show, /id="itas-recovery-code"[^>]*>ABCD-EFGH</);
  assert.match(show, /แสดงครั้งเดียว/);
  assert.doesNotMatch(show, /itas-recovery-copy|คัดลอกรหัส|<button[^>]*>[^<]*คัดลอก/, "รหัสกู้คืนต้องจด/พิมพ์เก็บ ไม่ผ่านคลิปบอร์ด");
  assert.match(show, /จดด้วยมือลงกระดาษ/);
  assert.match(show, /ไม่ควรคัดลอก/);
  assert.match(show, /พิมพ์รหัสกู้คืนกลับเข้ามาเพื่อยืนยันว่าจดแล้ว/);
  assert.match(show, /ยืนยันและตั้งตู้เซฟ/);
  assert.match(pages.recoveryShow({ code: "X", mode: "recovery" }), /ยืนยันและเปลี่ยนรหัสกู้คืน/);
  assert.match(pages.changeForm(), /รหัสตู้เซฟปัจจุบัน/);
  assert.equal(pages.strengthText({ label: "ดี" }), "ความแข็งแรง: ดี");
  assert.equal(pages.strengthText({ label: "" }), "");
});

test("type list and toolbar", () => {
  const types = [{ code: "COMPUTER", name: "เครื่องคอมพิวเตอร์", asset_count: 12, is_active: true }, { code: "OLD", name: `เก่า ${XSS}`, asset_count: 0, is_active: false }];
  const html = pages.typeList(types, "COMPUTER");
  assert.match(html, /data-itas-type="COMPUTER" aria-pressed="true"/);
  assert.match(html, /data-itas-type="OLD" aria-pressed="false"/);
  assert.match(html, /is-off/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, />12</);
  assert.match(pages.typeList([], ""), /ยังไม่มีชนิดอุปกรณ์/);
  const toolbar = pages.toolbar({ query: `"><b>`, status: "broken" });
  assert.match(toolbar, /value="&quot;&gt;&lt;b&gt;"/);
  assert.match(toolbar, /<option value="broken" selected>ชำรุด<\/option>/);
  assert.match(toolbar, /id="itas-add"/);
  assert.doesNotMatch(pages.toolbar({ canAdd: false }), /itas-add/);
});

test("asset table: escapes every cell, status badge, sortable headers with aria-sort, rows are keyboard-focusable and carry only the id", () => {
  const columns = model.tableColumns(TYPE);
  const html = pages.assetTable({ rows: [ASSET], columns, sort: { key: "reg_no", direction: "descending" }, typeName: TYPE.name });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /aria-sort="descending"/);
  assert.match(html, /data-itas-sort="reg_no"[^>]*>เลขทะเบียน ▼/);
  assert.match(html, /<span class="badge approved">ใช้งาน<\/span>/);
  assert.match(html, new RegExp(`data-itas-row="${ID}" tabindex="0"`));
  assert.match(html, /class="table-wrap itas-scroll"/);
  assert.match(html, /05\/03\/2568/);
  assert.ok(!html.includes(CIPHER) && !/license|ip"/i.test(visibleText(html)), "ตารางไม่แสดงช่องลับ/ciphertext");
  assert.match(pages.assetTable({ rows: [], columns, typeName: "x" }), /ไม่พบอุปกรณ์/);
});

test("asset form (add): fields come from the type definition, dates are typed text, choices are selects, secret section is locked-safe", () => {
  const html = pages.assetForm({ mode: "add", type: TYPE, values: model.emptyFormValues(TYPE), vaultStatus: "locked" });
  assert.match(html, /เพิ่มเครื่องคอมพิวเตอร์/);
  assert.match(html, /name="reg_no"/);
  assert.match(html, /name="device_code"/);
  assert.match(html, /name="attrs.cpu"/);
  assert.match(html, /<select class="select" id="itas-f-attrs-kind" name="attrs.kind"><option value=""><\/option><option value="PC">PC<\/option>/);
  assert.match(html, /name="attrs.installed" type="text" data-date-text/);
  assert.match(html, /name="install_date" type="text" data-date-text/);
  assert.match(html, /ข้อมูลเฉพาะเครื่องคอมพิวเตอร์/);
  assert.doesNotMatch(html, /name="attrs.ip"|name="attrs.license_os"/, "ช่องลับไม่อยู่ในช่องธรรมดา");
  assert.doesNotMatch(html, /itas-history-load/, "ฟอร์มเพิ่มไม่มีประวัติ");
  assert.match(html, /ปลดล็อกตู้เซฟเพื่อดู\/แก้ช่องลับ/);
  assert.doesNotMatch(html, /<input[^>]*data-secret-input/);
  // ชนิดที่ไม่มีรหัสอุปกรณ์/ช่องลับ
  const mouse = pages.assetForm({ mode: "add", type: { code: "MOUSE", name: "เมาส์", fields: [], has_device_code: false }, values: model.emptyFormValues({ fields: [], has_device_code: false }) });
  assert.doesNotMatch(mouse, /name="device_code"/);
  assert.doesNotMatch(mouse, /itas-secrets"/);
});

test("asset form (edit): values escaped, history button, secret fields masked and never carry ciphertext or plaintext", () => {
  const values = model.formValuesFromAsset(ASSET, TYPE);
  const html = pages.assetForm({ mode: "edit", type: TYPE, values, asset: ASSET, vaultStatus: "locked" });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /value="&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;"/);
  assert.match(html, /id="itas-history-load"/);
  assert.match(html, /name="installed"|name="attrs.installed"[^>]*value=""/);
  assert.match(html, /name="install_date"[^>]*value="05\/03\/2568"/);
  assert.match(html, /•••• \(ปลดล็อกเพื่อดู\/แก้\)/);
  assert.match(html, /data-secret="ip"[\s\S]*?มีค่าอยู่/);
  assert.match(html, /data-secret="license_os"[\s\S]*?ยังไม่มีค่า/);
  assert.ok(!html.includes(CIPHER), "ไม่มี ciphertext ในหน้า");
  assert.doesNotMatch(html, /data-secret-input/);
  for (const status of ["locked", "uninitialized", "unknown"]) {
    const section = pages.secretsSection({ fields: model.secretFields(TYPE), asset: ASSET, vaultStatus: status });
    assert.doesNotMatch(section, /data-secret-input|data-secret-act/, status);
  }
  assert.match(pages.secretsSection({ fields: model.secretFields(TYPE), asset: null, vaultStatus: "uninitialized" }), /ตั้งตู้เซฟก่อน/);
});

test("secret section when unlocked: shown value is masked, buttons per field, empty fields get a ready input, nothing is pre-filled", () => {
  const html = pages.secretsSection({ fields: model.secretFields(TYPE), asset: ASSET, vaultStatus: "unlocked" });
  const ip = /<div class="field itas-secret" data-secret="ip"[\s\S]*?<\/div>\s*<small data-secret-note>[^<]*<\/small>\s*<\/div>/.exec(html)[0];
  assert.match(ip, /data-has-value="1"/);
  assert.match(ip, /data-secret-shown[^>]*>••••••••</);
  assert.match(ip, /data-secret-act="show"/);
  assert.match(ip, /data-secret-act="edit"/);
  assert.match(ip, /data-secret-act="clear"/);
  assert.match(ip, /<input[^>]*type="password"[^>]*data-secret-input data-mask hidden/);
  const os = /data-secret="license_os"[\s\S]*$/.exec(html)[0];
  assert.match(os, /data-has-value="0"/);
  assert.match(os, /data-secret-shown[^>]*>—</);
  assert.doesNotMatch(os, /data-secret-act/);
  assert.match(os, /<input[^>]*type="password"[^>]*data-secret-input data-mask>/);
  assert.doesNotMatch(html, /<input[^>]*\svalue=/);
  assert.ok(!html.includes(CIPHER));
  assert.equal(pages.secretsSection({ fields: [], asset: null, vaultStatus: "unlocked" }), "");
});

test("history panel escapes text and shows secrets only as 'changed (secret)'", () => {
  const view = { log: [{ id: 1, actionLabel: "แก้ไข", by: `IT <b>x</b>`, at: "01/01/2569 10:00", created: false, changes: [{ label: "ชื่อ", from: XSS, to: "ใหม่", secret: false }, { label: "IP", from: "", to: "เปลี่ยนค่า (ลับ)", secret: true }] }], moves: [{ id: 2, by: "IT", at: "x", parts: ["ติดตั้งที่: — → COM12"] }] };
  const html = pages.historyPanel(view);
  assert.doesNotMatch(html, /<img|<b>x/);
  assert.match(html, /<strong>IP:<\/strong> เปลี่ยนค่า \(ลับ\)/);
  assert.match(html, /ติดตั้งที่: — → COM12/);
  assert.match(pages.historyPanel({ log: [], moves: [] }), /ยังไม่มีประวัติการแก้ไข[\s\S]*ยังไม่มีประวัติการย้าย/);
});

test("main page layout: purge button only in test mode; error card; page wrapper carries the module palette", () => {
  const vault = { status: "locked", isTest: true };
  const main = pages.mainPage({ isTest: true, vault, content: pages.layout({ types: [], selectedCode: "", main: "" }) });
  assert.match(main, /id="itas-purge"/);
  assert.match(main, /id="itas-vault-bar-host"/);
  assert.match(main, /id="itas-vault-panel"/);
  assert.match(main, /data-module="it"/);
  assert.doesNotMatch(pages.mainPage({ isTest: false, vault, content: "" }), /itas-purge/);
  assert.match(pages.errorCard("ข้อความ <b>"), /&lt;b&gt;/);
  assert.match(pages.errorCard("x", { retry: false }), /^((?!itas-retry).)*$/s);
  const panel = pages.mainPanel({ type: { name: "เมาส์", is_active: false }, toolbarHtml: "", countText: "0 รายการ", tableHtml: "", notice: "โหลดไม่ครบ" });
  assert.match(panel, /ปิดใช้งาน/);
  assert.match(panel, /id="itas-form-area"/);
  assert.match(panel, /โหลดไม่ครบ/);
});

test("no page string puts a user value into a data-* attribute other than ids/keys, and no secret-looking value is in any template", () => {
  const html = [pages.assetForm({ mode: "edit", type: TYPE, values: model.formValuesFromAsset(ASSET, TYPE), asset: ASSET, vaultStatus: "unlocked" }), pages.assetTable({ rows: [ASSET], columns: model.tableColumns(TYPE) })].join("");
  for (const match of html.matchAll(/\sdata-([a-z-]+)="([^"]*)"/g)) {
    assert.doesNotMatch(match[2], /onerror|<|alert/, `${match[1]}`);
  }
  assert.doesNotMatch(html, /Y2lwaGVy|ciphertext/);
});
