// modules/module-itar.js: ตรวจแบบอ่านโค้ดว่าทุก RPC และชื่อพารามิเตอร์ที่หน้าเว็บเรียกมีอยู่จริงใน migration 20270107010000_itar_access_requests.sql
// (ฐานข้อมูลจริงทดสอบที่ supabase/tests/database/itar_*.test.sql) + โครงของโมดูล: ประกาศตัวเองให้การ์ด ไม่ใช้ key ลับ ไม่มีช่องรหัสผ่าน
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").split("\r\n").join("\n");
const migration = read("supabase/migrations/20270107010000_itar_access_requests.sql");
const moduleSource = read("modules/module-itar.js");
const model = require("../../modules/itar-model.js");

// ลายเซ็น (ข้อความระหว่าง "function public.<ชื่อ>(" ถึง "returns") ของฟังก์ชัน public ใน migration
function signatureOf(name) {
  const start = migration.indexOf(`function public.${name}(`);
  if (start < 0) return null;
  return migration.slice(start, migration.indexOf("returns", start));
}

test("every RPC the page calls is defined in the migration, with the parameter names it sends", () => {
  const calls = [...moduleSource.matchAll(/rpc\("([a-z_]+)"(?:,\s*(\{[^}]*\}))?/g)];
  assert.ok(calls.length >= 14, "the module calls the contract's RPCs");
  const seen = new Set();
  for (const [, name, args] of calls) {
    seen.add(name);
    if (name === "app_sandbox_purge_itar") { assert.ok(migration.includes("function public.app_sandbox_purge_itar("), name); continue; }
    const signature = signatureOf(name);
    assert.ok(signature, `${name} is defined in the migration`);
    for (const [, key] of (args ?? "").matchAll(/\b(p_[a-z_]+):/g)) assert.ok(signature.includes(key), `${name} takes ${key}`);
  }
  for (const name of ["app_itar_my_role", "app_itar_list_mine", "app_itar_list_pending_approvals", "app_itar_pending_count", "app_itar_list_it", "app_itar_list_staff", "app_itar_get_doc_counter", "app_itar_set_next_doc_seq", "app_itar_get_detail", "app_itar_form_context", "app_itar_search_subjects", "app_itar_create", "app_itar_add_attachment", "app_itar_add_comment_attachment", "app_sandbox_purge_itar"]) {
    assert.ok(seen.has(name), `${name} is used by the page`);
  }
});

test("the RPCs behind the action buttons, and the parameters of create and the info forms, match the contract", () => {
  for (const [action, spec] of Object.entries(model.ACTION_BUTTONS)) assert.ok(signatureOf(spec.rpc), `${action} -> ${spec.rpc}`);
  const create = model.createParams({ type: "new", reason: "x", items: [], subject: {} });
  const createSignature = signatureOf("app_itar_create");
  for (const key of Object.keys(create)) assert.ok(createSignature.includes(key), `app_itar_create takes ${key}`);
  const info = model.infoParams("id", { body: "x" });
  for (const rpcName of ["app_itar_request_info", "app_itar_provide_info"]) for (const key of Object.keys(info)) assert.ok(signatureOf(rpcName).includes(key), `${rpcName} takes ${key}`);
  assert.deepEqual(Object.keys(info), ["p_request_id", "p_body"]);
  assert.ok(signatureOf("app_itar_form_context").includes("p_request_type") && signatureOf("app_itar_form_context").includes("p_subject"));
  assert.ok(signatureOf("app_itar_search_subjects").includes("p_search"));
  // อัปโหลดไฟล์: ใช้ bucket และรูป path ที่ migration กำหนด
  assert.ok(migration.includes("'itar-files'") && migration.includes("'itar-test-files'"));
  assert.ok(moduleSource.includes("model.fileBucket("));
});

test("the page tolerates a database without the migration: every read goes through a path that shows a Thai message instead of breaking the app", () => {
  // my_role ล้ม (ไม่มีฟังก์ชัน) → หน้าแสดงข้อความ "ฐานข้อมูลยังไม่ได้อัปเดต" ผ่าน errorPage · การ์ดคืน null ("ดูสถานะ")
  assert.match(moduleSource, /role = await rpc\("app_itar_my_role"\);\n    \} catch \(error\) \{\n      return errorPage\(error, version\);/);
  assert.match(moduleSource, /role = await rpc\("app_itar_my_role"\);\n    \} catch \{\n      return null;/);
  assert.match(model.describeError({ code: "PGRST202" }).message, /ฐานข้อมูลยังไม่ได้อัปเดต/);
  assert.match(moduleSource, /catch \(error\) \{\n      return errorPage\(error, version\);\n    \}\n  \}\n\n  \/\* ---------- แท็บ/, "route errors are caught");
});

test("the module registers itself for the card, the leave warning and the office router, and keeps secrets out", () => {
  assert.match(moduleSource, /window\.MNP_ITAR = api;/);
  assert.match(moduleSource, /\(window\.MNP_OFFICE_CARDS \?\?= \{\}\)\.IT_ACCESS_REQUEST = api;/);
  assert.match(moduleSource, /unsavedCount/);
  assert.match(read("modules/module-office.js"), /window\.MNP_ITAR\.render\(params\)/);
  assert.match(read("app.js"), /window\.MNP_ITAR\?\.unsavedCount\?\.\(\) \?\? 0/);
  for (const file of ["modules/module-itar.js", "modules/itar-pages.js", "modules/itar-model.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /type="password"|service_role|secret key|sb_secret|eyJ[A-Za-z0-9_-]{20}/i, `${file} has no password field or key`);
  }
});

test("index.html loads the three files model, pages, module in order, before app.js, with the shared cache token", () => {
  const html = read("index.html");
  const scripts = [...html.matchAll(/<script defer src="\.\/([^"?]+)\?v=([^"]+)"/g)].map((match) => ({ file: match[1], token: match[2] }));
  const at = (file) => scripts.findIndex((script) => script.file === file);
  assert.ok(at("modules/itar-model.js") >= 0);
  assert.ok(at("modules/itar-model.js") < at("modules/itar-pages.js") && at("modules/itar-pages.js") < at("modules/module-itar.js") && at("modules/module-itar.js") < at("app.js"));
  assert.ok(at("modules/module-office.js") < at("modules/module-itar.js"));
  assert.equal(new Set(scripts.map((script) => script.token)).size, 1, "one token for every script");
  assert.equal(scripts[at("modules/module-itar.js")].token, "20261128itarweb");
});
