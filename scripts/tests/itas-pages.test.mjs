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
  assert.match(html, /<p class="itas-version no-print"[^>]*>V1.06<\/p>/);
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

test("type chips: all + used types first, empty types folded under 'other types', selected state, escaping; toolbar has one search box and one add button", () => {
  const types = [
    { code: "COMPUTER", name: "เครื่องคอมพิวเตอร์", asset_count: 12, is_active: true },
    { code: "MOUSE", name: "เมาส์", asset_count: 0, is_active: true },
    { code: "OLD", name: `เก่า ${XSS}`, asset_count: 2, is_active: false },
  ];
  const html = pages.typeChips({ types, selectedCode: "COMPUTER", total: 14 });
  assert.match(html, /data-itas-type="" aria-pressed="false"><span class="itas-chip-name">ทั้งหมด<\/span><span[^>]*>14</);
  assert.match(html, /data-itas-type="COMPUTER" aria-pressed="true"/);
  assert.match(html, /data-itas-type="OLD" aria-pressed="false"/);
  assert.match(html, /is-off/);
  assert.doesNotMatch(html, /<img/);
  assert.ok(html.indexOf("COMPUTER") < html.indexOf("OLD") && html.indexOf("OLD") < html.indexOf("itas-types-more"), "ชนิดที่มีของมาก่อน ปุ่มชนิดอื่นๆ อยู่ท้าย");
  assert.doesNotMatch(html, /data-itas-type="MOUSE"/, "ชนิดว่างถูกพับไว้");
  assert.match(html, /id="itas-types-more" aria-expanded="false">ชนิดอื่นๆ \(1\) ▾/);
  const open = pages.typeChips({ types, selectedCode: "MOUSE", total: 14, showEmpty: true });
  assert.match(open, /data-itas-type="MOUSE" aria-pressed="true"/);
  assert.match(open, /aria-expanded="true"/);
  assert.doesNotMatch(pages.typeChips({ types: [types[0]], total: 12 }), /itas-types-more/, "ไม่มีชนิดว่าง = ไม่มีปุ่ม");
  const toolbar = pages.toolbar({ query: `"><b>`, status: "broken" });
  assert.match(toolbar, /value="&quot;&gt;&lt;b&gt;"/);
  assert.match(toolbar, /<option value="broken" selected>ชำรุด<\/option>/);
  assert.equal(count(toolbar, /type="search"/g), 1);
  assert.match(toolbar, /placeholder="ค้นหาทุกชนิด[^"]*ผู้ใช้[^"]*สถานที่"/);
  assert.match(toolbar, /id="itas-add">\+ เพิ่มอุปกรณ์/);
  assert.doesNotMatch(pages.toolbar({ canAdd: false }), /itas-add/);
});

test("asset table: escapes every cell, status badge, sortable headers with aria-sort, rows are keyboard-focusable and carry only the id", () => {
  const columns = model.tableColumns(TYPE);
  const html = pages.assetTable({ rows: [ASSET], columns, sort: { key: "reg_no", direction: "descending" }, typeName: TYPE.name });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /aria-sort="descending"/);
  assert.match(html, /data-itas-sort="reg_no"[^>]*>เลขทะเบียน ▼/);
  assert.match(html, /<span class="badge itas-status is-ok">ใช้งาน<\/span>/);
  assert.match(html, new RegExp(`data-itas-row="${ID}" tabindex="0"`));
  assert.match(html, /class="table-wrap itas-scroll"/);
  assert.match(html, /05\/03\/2568/);
  assert.ok(!html.includes(CIPHER) && !/license|ip"/i.test(visibleText(html)), "ตารางไม่แสดงช่องลับ/ciphertext");
  assert.match(pages.assetTable({ rows: [], columns, typeName: "x" }), /ไม่พบอุปกรณ์/);
});

test("asset form (add): fields come from the type definition, dates are typed text, choices are selects, secret section is locked-safe", () => {
  const html = pages.assetForm({ mode: "add", type: TYPE, values: model.emptyFormValues(TYPE), vaultStatus: "locked" });
  assert.match(html, /<h2[^>]*>เพิ่มอุปกรณ์<\/h2>/);
  assert.doesNotMatch(html, /name="type_code"/, "ไม่ส่ง types = ไม่มีตัวเลือกชนิด");
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

test("asset form: only code, name, brand/model, user (+ status) are always visible; everything else is folded under 'more details'; secrets stay outside the fold", () => {
  const split = (html) => { const at = html.indexOf('<details class="itas-more"'); const end = html.indexOf("</details>"); return { head: html.slice(0, at), fold: html.slice(at, end), tail: html.slice(end) }; };
  const html = pages.assetForm({ mode: "add", type: TYPE, values: model.emptyFormValues(TYPE), vaultStatus: "locked", types: [TYPE] });
  const { head, fold, tail } = split(html);
  for (const name of ["type_code", "reg_no", "device_code", "name", "model", "host_code", "status"]) assert.match(head, new RegExp(`name="${name}"`), `${name} เห็นเสมอ`);
  for (const name of ["serial", "slot", "place", "install_date", "purchase_date", "vendor", "price", "warranty_text", "express_code", "account_no", "note", "attrs.cpu", "attrs.kind", "attrs.installed"]) {
    assert.doesNotMatch(head, new RegExp(`name="${name}"`), `${name} ต้องไม่อยู่ในช่องหลัก`);
    assert.match(fold, new RegExp(`name="${name}"`), `${name} พับอยู่ใต้รายละเอียดเพิ่มเติม`);
  }
  assert.match(head, /ยี่ห้อ \/ รุ่น/);
  assert.match(head, /ผู้ใช้ \/ ติดตั้งที่ \(Used by\)/, "ชนิดที่ไม่มี user_name ใช้ ติดตั้งที่ เป็นผู้ใช้");
  assert.doesNotMatch(fold, /open/, "เพิ่มใหม่เริ่มแบบพับ");
  assert.match(tail, /id="itas-secrets-host"/, "ช่องลับอยู่นอกส่วนที่พับ");
  assert.match(pages.assetForm({ mode: "add", type: TYPE, values: model.emptyFormValues(TYPE), openMore: true }), /<details class="itas-more" id="itas-more" open>/);
  // ชนิดที่มีช่อง user_name (เครื่องคอมพิวเตอร์จริง): ผู้ใช้เป็นช่อง user_name ส่วน ติดตั้งที่ ไปอยู่ในส่วนที่พับ
  const computer = { ...TYPE, fields: [{ key: "user_name", label: "ชื่อผู้ใช้ (User)", type: "text", secret: false, order: 1 }, ...TYPE.fields] };
  const pc = split(pages.assetForm({ mode: "add", type: computer, values: model.emptyFormValues(computer) }));
  assert.match(pc.head, /name="attrs.user_name"/);
  assert.doesNotMatch(pc.head, /name="host_code"/);
  assert.match(pc.fold, /name="host_code"/);
  // ชนิดที่ไม่มีรหัสอุปกรณ์ไม่มีช่องรหัสอุปกรณ์เลย
  const mouse = { code: "MOUSE", name: "เมาส์", fields: [], has_device_code: false };
  assert.doesNotMatch(pages.assetForm({ mode: "add", type: mouse, values: model.emptyFormValues(mouse) }), /name="device_code"/);
});

test("suggestions render as escaped datalists attached to plain text inputs only; the remembered-values notice has a clear button", () => {
  const suggestions = { core: { model: ["Dell 3050", XSS], place: ["สำนักงาน"], install_date: ["01/01/2568"] }, attrs: { cpu: ["i5"], kind: ["PC"] } };
  const html = pages.assetForm({ mode: "add", type: TYPE, values: model.emptyFormValues(TYPE), suggestions, remembered: [{ key: "model", label: "ยี่ห้อ / รุ่น", value: "Dell 3050" }, { key: "place", label: "สถานที่", value: XSS }] });
  assert.match(html, /<datalist id="itas-dl-model"><option value="Dell 3050"><\/option><option value="&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;"><\/option><\/datalist>/);
  assert.match(html, /<datalist id="itas-dl-attrs-cpu">/);
  assert.match(html, /name="model" type="text" autocomplete="off" list="itas-dl-model"/);
  assert.match(html, /name="place" type="text" autocomplete="off" list="itas-dl-place"/);
  assert.match(html, /name="attrs.cpu" type="text" autocomplete="off" list="itas-dl-attrs-cpu"/);
  assert.doesNotMatch(html, /name="install_date"[^>]*list=/, "ช่องวันที่ไม่มีคำแนะนำ");
  assert.doesNotMatch(html, /name="attrs.kind"[^>]*list=/, "ช่องตัวเลือกไม่มีคำแนะนำ");
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /id="itas-remembered"[^>]*>เติมให้จากรายการล่าสุดของชนิดนี้: <strong>ยี่ห้อ \/ รุ่น<\/strong> Dell 3050 · <strong>สถานที่<\/strong> &lt;img/);
  assert.match(html, /id="itas-clear-remembered">ล้างค่าที่เติมให้/);
  const plainForm = pages.assetForm({ mode: "add", type: TYPE, values: model.emptyFormValues(TYPE) });
  assert.doesNotMatch(plainForm, /datalist|itas-remembered|list=/);
});

test("batch section: only in the add form; checkbox + hidden panel; options follow the type; the lines box is escaped; secrets host is hidden while batch is on; results and problems escape everything", () => {
  const add = pages.assetForm({ mode: "add", type: TYPE, values: model.emptyFormValues(TYPE) });
  assert.match(add, /<input type="checkbox" id="itas-batch-toggle" name="batch_on"> เพิ่มหลายเครื่องรุ่นเดียวกัน/);
  assert.match(add, /<div id="itas-batch-panel" hidden>/);
  assert.match(add, /<option value="device_code,serial">รหัสอุปกรณ์ \+ Serial<\/option>/);
  assert.match(add, /name="batch_lines"/);
  assert.doesNotMatch(add, /id="itas-secrets-host" hidden/);
  const on = pages.assetForm({ mode: "add", type: TYPE, values: model.emptyFormValues(TYPE), batch: { on: true, columns: "device_code,serial", lines: `a${XSS}` } });
  assert.match(on, /id="itas-batch-toggle" name="batch_on" checked>/);
  assert.match(on, /<div id="itas-batch-panel">/);
  assert.match(on, /<option value="device_code,serial" selected>/);
  assert.match(on, /<textarea[^>]*name="batch_lines"[^>]*>a&lt;img/);
  assert.match(on, /id="itas-secrets-host" hidden>/, "โหมดนี้ไม่รองรับช่องลับ");
  assert.doesNotMatch(on, /<img/);
  assert.doesNotMatch(pages.assetForm({ mode: "edit", type: TYPE, values: model.formValuesFromAsset(ASSET, TYPE), asset: ASSET }), /itas-batch/, "แก้ไขไม่มีเพิ่มหลายเครื่อง");
  const noCode = pages.assetForm({ mode: "add", type: { code: "MOUSE", name: "เมาส์", fields: [], has_device_code: false }, values: model.emptyFormValues({ fields: [] }) });
  assert.doesNotMatch(noCode, /value="device_code/);
  const result = pages.batchResult({ added: 2, failed: [{ line: 3, label: `SN${XSS}`, message: "เลขทะเบียนซ้ำ" }], notTried: [{ line: 4, label: "SN4" }] });
  assert.match(result, /เพิ่มสำเร็จ 2 รายการ/);
  assert.match(result, /ยังไม่สำเร็จ 2 รายการ/);
  assert.match(result, /<strong>SN&lt;img[^<]*<\/strong>: เลขทะเบียนซ้ำ/);
  assert.match(result, /ยังไม่ได้ส่ง: SN4/);
  assert.match(pages.batchResult({ added: 3 }), /form-message success/);
  assert.doesNotMatch(result, /<img/);
  const problems = pages.batchProblems([{ message: `บรรทัด 2: ${XSS}` }]);
  assert.match(problems, /ยังไม่ได้เพิ่มอะไร/);
  assert.doesNotMatch(problems, /<img/);
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

/* ---------- รุ่น 1.02: หน้าเครื่องคอมพิวเตอร์ + สีหมวด/สถานะ ---------- */
const H_TYPES = [
  { code: "COMPUTER", name: "เครื่องคอมพิวเตอร์", has_device_code: true, is_active: true, asset_count: 1, fields: TYPE.fields },
  { code: "CPU", name: "CPU", has_device_code: false, is_active: true, asset_count: 1, fields: [{ key: "speed", label: "ความเร็ว", type: "text", secret: false, order: 1 }, { key: "pw", label: "รหัสลับ", type: "text", secret: true, order: 2 }] },
  { code: "MONITOR", name: "จอภาพ", has_device_code: true, is_active: true, asset_count: 1, fields: [] },
];
const HOST = { ...ASSET, secrets: { ip: { v: 1, n: "AAAAAAAAAAAAAAAA", c: CIPHER } } };
const PARTS = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", type_code: "CPU", reg_no: "CPU-1", name: `ชิป ${XSS}`, model: "Intel", status: "in_use", slot: "CPU1", host_code: "COM12", attrs: { speed: "3.2 GHz", pw: "SECRET-SPEC" }, secrets: { pw: { v: 1, n: "AAAAAAAAAAAAAAAA", c: CIPHER } } },
  { id: "aaaaaaaa-0000-4000-8000-000000000002", type_code: "MONITOR", reg_no: "MNT-1", device_code: "MNT1", name: "จอ 24", status: "retired", host_code: "COM12", attrs: {}, secrets: {} },
];

test("status pill: green in use, blue spare, red broken, grey retired; the badge colours are not borrowed from approval states any more", () => {
  const html = ["in_use", "spare", "broken", "retired"].map(pages.statusPill).join("");
  assert.match(html, /itas-status is-ok">ใช้งาน</);
  assert.match(html, /itas-status is-spare">สำรอง</);
  assert.match(html, /itas-status is-bad">ชำรุด</);
  assert.match(html, /itas-status is-off">ยกเลิกใช้งาน</);
  assert.doesNotMatch(html, /badge (approved|in_progress|rejected|cancelled)/);
});

test("type chips carry a line icon and the category colour; the all chip has none", () => {
  const html = pages.typeChips({ types: H_TYPES, total: 3 });
  assert.match(html, /<button type="button" class="itas-chip is-selected" data-itas-type="" [^>]*><span class="itas-chip-name">ทั้งหมด/, "ทั้งหมด: ไม่มีไอคอน/หมวด");
  assert.match(html, /class="itas-chip is-host"[^>]*data-itas-type="COMPUTER"[^>]*><svg class="ui-icon itas-glyph"/);
  assert.match(html, /class="itas-chip is-internal"[^>]*data-itas-type="CPU"/);
  assert.match(html, /class="itas-chip is-peripheral"[^>]*data-itas-type="MONITOR"/);
  assert.equal(count(html, /<svg/g), 3);
});

test("asset table (all types): type pill with icon, mono codes, parts count on computer rows only, host rows marked, empty parts cell on other rows", () => {
  const index = model.buildHostIndex([HOST, ...PARTS]);
  const columns = model.allColumns(H_TYPES, index);
  const html = pages.assetTable({ rows: [HOST, PARTS[0]], columns, sort: null });
  assert.match(html, /<tr class="itas-row status-in_use is-host" data-itas-row="2a500000-0000-4000-8000-000000000001" tabindex="0">/);
  assert.match(html, /<span class="itas-kind is-host" title="เครื่องคอมพิวเตอร์"><svg[^>]*>.*<\/svg><span>เครื่องคอมพิวเตอร์<\/span><\/span>/);
  assert.match(html, /<span class="itas-kind is-internal"/);
  assert.match(html, /<span class="itas-partcount itas-mono">1 ชิ้น<\/span>/, "จอที่ยกเลิกใช้งานไม่นับ");
  assert.match(html, /<td class="itas-mono" data-label="เลขทะเบียน">COM-001<\/td>/);
  assert.match(html, /<td class="itas-cell-empty" data-label="ชิ้นส่วน"><\/td>/);
  assert.doesNotMatch(html, /<img/);
  assert.ok(!html.includes("SECRET-SPEC") && !html.includes(CIPHER));
  // ไม่มี index (โหลดไม่ครบ) = ไม่มีคอลัมน์ชิ้นส่วนเลย
  assert.doesNotMatch(pages.assetTable({ rows: [HOST], columns: model.allColumns(H_TYPES) }), /ชิ้นส่วน/);
});

test("computer page: dark header with code/name/status/facts, grouped parts (internal then peripherals) as buttons carrying only the id, secrets never shown, everything escaped", () => {
  const html = pages.hostBody({ host: { ...HOST, name: `เครื่อง ${XSS}` }, type: H_TYPES[0], parts: PARTS, types: H_TYPES });
  assert.match(html, /id="itas-host-back"[^>]*>‹ กลับไปทะเบียนอุปกรณ์</);
  assert.match(html, /<p class="itas-host-code itas-mono">COM12<\/p>/);
  assert.match(html, /<h2 id="itas-host-title">เครื่อง &lt;img src=x/);
  assert.match(html, /itas-status is-ok">ใช้งาน</);
  assert.match(html, /<dt>ยี่ห้อ \/ รุ่น<\/dt><dd class="itas-mono">Dell<\/dd>/);
  assert.match(html, /itas-host-counts itas-mono">1 ชิ้น · เลิกใช้ 1</, "ชิ้นส่วน 1 ต่อพ่วงที่ยกเลิกใช้งานแสดงแยก");
  assert.match(html, /id="itas-host-edit"/);
  const internal = html.indexOf('itas-group-card is-internal');
  const peripheral = html.indexOf('itas-group-card is-peripheral');
  assert.ok(internal > 0 && peripheral > internal, "ชิ้นส่วนภายในก่อนอุปกรณ์ต่อพ่วง");
  assert.match(html, /<button type="button" class="itas-part is-internal" data-itas-part="aaaaaaaa-0000-4000-8000-000000000001">/);
  assert.match(html, /<button type="button" class="itas-part is-peripheral is-retired" data-itas-part="aaaaaaaa-0000-4000-8000-000000000002">/);
  assert.match(html, /itas-part-slot" title="ช่อง\/ตำแหน่ง">CPU1</);
  assert.match(html, /Intel · ความเร็ว: 3\.2 GHz/);
  assert.doesNotMatch(html, /<img/);
  assert.ok(!html.includes("SECRET-SPEC") && !html.includes("รหัสลับ") && !html.includes(CIPHER) && !/10\.1\.1\.1/.test(html), "ช่องลับไม่ออกมาในหน้า");
  assert.match(html, /id="itas-host-moves-load"/, "ปุ่มดูประวัติการย้าย");
});

test("computer page: no parts shows an empty state that tells how to link one; a computer without any code says it cannot be linked; truncation notice and error/loading states", () => {
  const empty = pages.hostBody({ host: HOST, type: H_TYPES[0], parts: [], types: H_TYPES });
  assert.match(empty, /ยังไม่มีชิ้นส่วนหรืออุปกรณ์ต่อพ่วงที่ผูกกับเครื่องนี้/);
  assert.match(empty, /ใส่ &quot;ติดตั้งที่&quot; = COM12|ใส่ "ติดตั้งที่" = COM12/);
  assert.doesNotMatch(empty, /itas-host-moves-load/, "ไม่มีชิ้นส่วน = ไม่มีประวัติให้ดึง");
  assert.match(empty, /itas-host-counts itas-mono">ไม่มีชิ้นส่วน</);
  assert.match(pages.hostBody({ host: { ...HOST, device_code: null, reg_no: null }, type: H_TYPES[0], parts: [], types: H_TYPES }), /ยังไม่มีรหัสอุปกรณ์หรือเลขทะเบียน/);
  assert.match(pages.hostBody({ host: HOST, type: H_TYPES[0], parts: PARTS, types: H_TYPES, partsNotice: "มี 900 รายการ" }), /rf-callout is-warn">มี 900 รายการ</);
  assert.match(pages.hostLoading(), /role="status">กำลังโหลดข้อมูลเครื่อง/);
  const error = pages.hostError(`พัง ${XSS}`);
  assert.match(error, /&lt;img/);
  assert.doesNotMatch(error, /<img/);
  assert.match(error, /id="itas-host-retry"/);
  assert.match(error, /id="itas-host-back"/);
  const shell = pages.hostShell("<p>x</p>");
  assert.ok(shell.indexOf('id="itas-form-area"') < shell.indexOf('id="itas-host-host"'), "ช่องฟอร์มอยู่นอกส่วนที่วาดซ้ำ");
});

test("computer page: move history section — hidden without parts, a load button first, then loading / error / the list (escaped) / empty", () => {
  assert.equal(pages.hostMovesSection(null, false), "");
  assert.match(pages.hostMovesSection(null, true), /id="itas-host-moves-load"/);
  assert.match(pages.hostMovesSection(null, true), /ชิ้นที่ย้ายออกไปแล้วไม่แสดง/);
  assert.match(pages.hostMovesSection({ status: "loading" }, true), /กำลังโหลดประวัติ/);
  assert.match(pages.hostMovesSection({ status: "error", message: "ล้ม" }, true), /role="alert">ล้ม/);
  const list = pages.hostMovesSection({ status: "ready", items: [{ at: "20/11/2569 10:00", by: "IT3462 สุริยา", part: `RAM ${XSS}`, details: ["ติดตั้งเข้าเครื่องนี้ (จาก COM7)"] }] }, true);
  assert.match(list, /20\/11\/2569 10:00/);
  assert.match(list, /ติดตั้งเข้าเครื่องนี้ \(จาก COM7\)/);
  assert.doesNotMatch(list, /<img/);
  assert.match(pages.hostMovesSection({ status: "ready", items: [] }, true), /ยังไม่มีประวัติการย้ายของชิ้นส่วนในเครื่องนี้/);
});

test("edit form of a part shows 'installed at COMxx' as a button only when the computer is known; escaped; the add form never shows it", () => {
  const type = H_TYPES[1];
  const asset = { ...PARTS[0], attrs: {}, secrets: {} };
  const values = model.formValuesFromAsset(asset, type);
  const withLink = pages.assetForm({ mode: "edit", type, values, asset, hostLink: { id: ID, label: `COM12 · เครื่อง ${XSS}` } });
  assert.match(withLink, new RegExp(`ติดตั้งอยู่ที่ <button type="button" class="itas-link" data-itas-host="${ID}">COM12 · เครื่อง &lt;img`));
  assert.doesNotMatch(withLink, /<img/);
  assert.doesNotMatch(pages.assetForm({ mode: "edit", type, values, asset }), /ติดตั้งอยู่ที่/);
  assert.doesNotMatch(pages.assetForm({ mode: "add", type, values, hostLink: { id: ID, label: "COM12" } }), /ติดตั้งอยู่ที่/);
});

/* ---------- รุ่น 1.03: หัวฟอร์ม + การ์ดชิ้นส่วนใน grid เดียว ---------- */
test("form header: back button, title and a save button live inside the form (so the busy state disables them and Enter/submit still reaches the form)", () => {
  for (const mode of ["add", "edit"]) {
    const html = pages.assetForm({ mode, type: TYPE, asset: mode === "edit" ? ASSET : null, values: model.emptyFormValues(TYPE), vaultStatus: "locked" });
    const form = html.slice(html.indexOf('<form id="itas-form"'), html.indexOf("</form>"));
    assert.match(form, /<div class="itas-form-head">/);
    assert.match(form, /id="itas-form-back">‹ ย้อนกลับ</);
    assert.match(form, /<h2 id="itas-form-title">/);
    assert.match(form, new RegExp(`itas-form-head-save">${mode === "edit" ? "บันทึก" : "เพิ่ม"}<`));
    assert.match(form, /id="itas-form-cancel"/, "ปุ่มล่างฟอร์มยังอยู่");
  }
});

test("computer page parts: every type of a kind goes into one grid of cards, each card labelled with its type icon + name (no per-type blocks)", () => {
  const html = pages.hostBody({ host: HOST, type: H_TYPES[0], parts: PARTS, types: H_TYPES });
  assert.doesNotMatch(html, /itas-typegroup/);
  assert.match(html, /<span class="itas-part-type"><svg[^>]*>.*?<\/svg><span>CPU<\/span><span class="itas-part-slot" title="ช่อง\/ตำแหน่ง">CPU1<\/span><\/span>/);
  assert.match(html, /<span class="itas-part-type"><svg[^>]*>.*?<\/svg><span>จอภาพ<\/span><\/span>/);
  assert.equal(count(html, /<ul class="itas-parts">/g), 2, "หมวดละ grid เดียว");
});

/* ---------- รุ่น 1.04: ตารางไม่ตัดรหัสกลางคำ + ชื่อชนิดสั้น ---------- */
test("typeShortName: Thai name when short, else the shorter of Thai/parenthetical, full name kept in title", () => {
  assert.equal(model.typeShortName("จอภาพ (Monitor)"), "จอภาพ");
  assert.equal(model.typeShortName("หมึก / โทนเนอร์ (INK&Toner)"), "หมึก / โทนเนอร์");
  assert.equal(model.typeShortName("โน้ตบุ๊ก / PC Set / แท็บเล็ต (Laptop-PCSet-Tablet)"), "Laptop-PCSet-Tablet");
  assert.equal(model.typeShortName("อุปกรณ์เสริมคอมพิวเตอร์ (Computer Accessories)"), "Computer Accessories");
  assert.equal(model.typeShortName("เครื่องคอมพิวเตอร์"), "เครื่องคอมพิวเตอร์", "ไม่มีวงเล็บ = ชื่อเดิม");
  assert.equal(model.typeShortName(""), "");
});

test("type chips use the short name and keep the full name in title; asset table pill does the same", () => {
  const long = "โน้ตบุ๊ก / PC Set / แท็บเล็ต (Laptop-PCSet-Tablet)";
  const types = [{ code: "LAPTOP", name: long, asset_count: 3, is_active: true }];
  const chips = pages.typeChips({ types, total: 3 });
  assert.ok(chips.includes('title="' + long + '"'), "ชื่อเต็มอยู่ใน title");
  assert.ok(chips.includes('<span class="itas-chip-name">Laptop-PCSet-Tablet</span>'));
  assert.ok(chips.includes('<span class="itas-chip-name">ทั้งหมด</span>'), "ชิป ทั้งหมด ไม่ถูกย่อ");
  const pill = pages.kindPill("LAPTOP", long);
  assert.ok(pill.includes('title="' + long + '"'));
  assert.ok(pill.includes("<span>Laptop-PCSet-Tablet</span>"));
});

test("table cells: codes/dates never wrap (itas-mono / itas-nowrap), long text columns wrap by word (itas-text)", () => {
  const columns = model.tableColumns({ ...TYPE, has_device_code: true });
  const html = pages.assetTable({ rows: [ASSET], columns });
  for (const label of ["เลขทะเบียน", "รหัสอุปกรณ์", "Serial", "ติดตั้งที่"]) assert.ok(html.includes('<td class="itas-mono" data-label="' + label + '">'), label);
  assert.ok(html.includes('<td class="itas-nowrap" data-label="วันที่ติดตั้ง">'));
  assert.ok(html.includes('<td class="itas-text" data-label="ชื่อ / รุ่น">'));
});

/* ---------- รุ่น 1.05: ชนิดสิ้นเปลือง (หมึก/โทนเนอร์) ไม่แสดงสถานะ ---------- */
const INK = { code: "INK_TONER", name: "หมึก / โทนเนอร์", has_device_code: false, is_active: true, fields: [] };
test("consumable type: table shows 'ซื้อ <date>' (or blank) instead of a status badge; other types keep the badge", () => {
  const ink = (extra) => ({ ...ASSET, type_code: "INK_TONER", status: "retired", ...extra });
  const columns = model.tableColumns(INK);
  const bought = pages.assetTable({ rows: [ink({ purchase_date: "2026-03-05" })], columns, typeName: INK.name });
  assert.match(bought, /<td class="itas-nowrap" data-label="สถานะ">ซื้อ 05\/03\/2569<\/td>/);
  assert.doesNotMatch(bought, /itas-status|ยกเลิกใช้งาน|status-retired/);
  const blank = pages.assetTable({ rows: [ink({ purchase_date: null })], columns, typeName: INK.name });
  assert.match(blank, /<td class="itas-cell-empty" data-label="สถานะ"><\/td>/);
  assert.match(pages.assetTable({ rows: [{ ...ASSET, status: "retired" }], columns: model.tableColumns(TYPE), typeName: TYPE.name }), /class="badge itas-status is-off">ยกเลิกใช้งาน</);
});

test("consumable form: no status select, hidden status keeps the DB value, purchase date + price move to the main section", () => {
  const values = (type, status) => ({ ...model.emptyFormValues(type), core: { ...model.emptyFormValues(type).core, status } });
  const html = pages.assetForm({ mode: "edit", type: INK, values: values(INK, "retired"), asset: { ...ASSET, type_code: "INK_TONER" }, vaultStatus: "locked" });
  assert.doesNotMatch(html, /<select[^>]*name="status"/);
  assert.match(html, /<input type="hidden" name="status" value="retired">/);
  assert.match(pages.assetForm({ mode: "add", type: INK, values: model.emptyFormValues(INK), vaultStatus: "locked" }), /<input type="hidden" name="status" value="in_use">/);
  const main = html.match(/<fieldset class="itas-group itas-primary">[\s\S]*?<\/fieldset>/)[0];
  assert.match(main, /name="purchase_date"/);
  assert.match(main, /name="price"/);
  assert.doesNotMatch(html.replace(main, ""), /name="purchase_date"|name="price"/);
  const other = pages.assetForm({ mode: "add", type: TYPE, values: model.emptyFormValues(TYPE), vaultStatus: "locked" });
  assert.match(other, /<select class="select" id="itas-f-status" name="status">/);
  assert.doesNotMatch(other, /type="hidden" name="status"/);
});

/* ---------- รุ่น 1.06: ปุ่มพิมพ์/ส่งออก + ใบพิมพ์ A4 ---------- */
test("toolbar: print and export buttons are there by default, disabled when nothing is listed, absent when output is off; the add button is independent", () => {
  const on = pages.toolbar({});
  assert.match(on, /id="itas-print"[^>]*>พิมพ์</);
  assert.match(on, /id="itas-export"[^>]*>ส่งออก Excel</);
  assert.doesNotMatch(on, /id="itas-print"[^>]*disabled/);
  assert.match(pages.toolbar({ hasRows: false }), /id="itas-print"[^>]* disabled/);
  assert.match(pages.toolbar({ hasRows: false }), /id="itas-export"[^>]* disabled/);
  const off = pages.toolbar({ canOutput: false });
  assert.doesNotMatch(off, /itas-print|itas-export/);
  assert.match(off, /id="itas-add"/);
  assert.doesNotMatch(pages.toolbar({ canAdd: false }), /id="itas-add"/);
  assert.match(pages.toolbar({ canAdd: false }), /id="itas-print"/);
});

test("host page: the print button sits next to edit", () => {
  const html = pages.hostBody({ host: { ...ASSET, attrs: {} }, type: TYPE, parts: [], types: [TYPE] });
  assert.match(html, /id="itas-host-print"[^>]*>พิมพ์</);
  assert.match(html, /id="itas-host-edit"/);
});

const listView = () => model.printList({ rows: [{ ...ASSET, name: XSS, model: "A&B", secrets: { ip: { c: CIPHER } }, attrs: { cpu: XSS } }], types: [TYPE], typeCode: "" });
test("print list sheet: head with title/filters/count/printed date, one header row (repeats per page via CSS), rows escaped, no secrets", () => {
  const html = pages.printListSheet({ view: listView(), filters: model.printFilterItems({ typeName: XSS, status: "in_use", query: XSS }), countText: "1 รายการ", printedAt: "25/11/2569 14:05", isTest: false });
  assert.match(html, /<h2>ทะเบียนอุปกรณ์ IT<\/h2>/);
  assert.match(html, /<dt>จำนวน:<\/dt><dd>1 รายการ<\/dd>/);
  assert.match(html, /<dt>วันที่พิมพ์:<\/dt><dd>25\/11\/2569 14:05<\/dd>/);
  assert.match(html, /<dt>สถานะ:<\/dt><dd>ใช้งาน<\/dd>/);
  assert.equal(count(html, /<thead>/g), 1);
  assert.doesNotMatch(html, /<img/, "ทุกค่า escape"); assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.match(html, /A&amp;B/);
  assert.doesNotMatch(html, new RegExp(CIPHER));
  assert.doesNotMatch(html, /ช่องลับ|ciphertext/i);
  assert.doesNotMatch(html, /การทดสอบ|ข้อมูลทดสอบ/);
  assert.match(pages.printListSheet({ view: listView(), filters: [], countText: "1 รายการ", printedAt: "x", isTest: true }), /itas-sheet-test">ข้อมูลทดสอบ/);
  assert.match(pages.printListSheet({ view: listView(), filters: [], countText: "1 รายการ", printedAt: "x", notice: "ไม่ครบ" }), /itas-sheet-notice">ไม่ครบ</);
  assert.match(pages.printListSheet({ view: model.printList({ rows: [], types: [TYPE] }), filters: [], countText: "0 รายการ", printedAt: "x" }), /ไม่มีรายการ/);
});

test("print host sheet: machine head, facts, two tables; escaped; no secret fields", () => {
  const ram = { code: "RAM", name: "RAM", fields: [{ key: "size", label: "ความจุ", type: "text", secret: false, order: 1 }, { key: "lic", label: "License", type: "text", secret: true, order: 2 }] };
  const part = { id: "p1", type_code: "RAM", reg_no: "RAM-1", name: XSS, model: "Kingston", slot: "A1", status: "in_use", attrs: { size: "8 GB", lic: "LIC-SECRET" }, secrets: { lic: { c: CIPHER } } };
  const view = model.hostPrint({ host: { ...ASSET, attrs: { user_name: XSS }, secrets: { ip: { c: CIPHER } } }, type: TYPE, parts: [part], types: [TYPE, ram] });
  const html = pages.printHostSheet({ view, printedAt: "25/11/2569 14:05" });
  assert.match(html, /<h2>ใบสรุปเครื่องคอมพิวเตอร์<\/h2>/);
  assert.match(html, /<dt>รหัสเครื่อง:<\/dt><dd>COM12<\/dd>/);
  assert.match(html, /ชิ้นส่วนภายใน \(1\)/);
  assert.match(html, /อุปกรณ์ต่อพ่วง \(0\)/);
  assert.match(html, /ไม่มีอุปกรณ์ต่อพ่วงที่ผูกกับเครื่องนี้/);
  assert.equal(count(html, /<thead>/g), 2);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, new RegExp(`${CIPHER}|LIC-SECRET|License`));
});
