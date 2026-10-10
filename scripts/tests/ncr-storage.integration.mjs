// Requires the local Supabase stack. Refuse non-local URLs before any write.
// Credentials stay in memory; only operation names/results are printed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const settings = JSON.parse(execFileSync("node_modules/.bin/supabase", ["status", "-o", "json"], { stdio: ["ignore", "pipe", "pipe"] }));
const url = new URL(settings.API_URL);
assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Storage integration tests require a local Supabase URL");
assert.ok(settings.ANON_KEY && settings.SERVICE_ROLE_KEY, "local Supabase credentials are required");
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const system = createClient(url.href, settings.SERVICE_ROLE_KEY, options);
const user = createClient(url.href, settings.ANON_KEY, options);
const tag = `ncr-storage-${randomUUID()}`;
const email = `${tag}@example.test`;
const password = randomUUID() + randomUUID();
const files = [];
const reports = [];
let authId;
let employeeId;

function checked(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data;
}
const payload = new TextEncoder().encode("NCR attachment integration test\n");
async function upload(client, bucket, path) {
  checked(await client.storage.from(bucket).upload(path, payload, { contentType: "text/plain", upsert: false }), "upload");
  files.push([bucket, path]);
}
async function issue(name) {
  const result = checked(await user.rpc("app_ncr_issue", {
    p_product_name: name, p_qty_total: 100, p_qty_defect: 10, p_unit: "ชิ้น", p_source: "in_process",
    p_defect_type_code: "DIM", p_description: "ทดสอบไฟล์แนบผ่าน Storage API",
  }), "issue NCR");
  assert.ok(result.id);
  reports.push(result.id);
  return result.id;
}
async function register(id, path) {
  checked(await user.rpc("app_ncr_add_attachment", {
    p_ncr_id: id, p_section: "report", p_storage_path: path, p_file_name: "หลักฐาน.txt",
  }), "register attachment");
}

try {
  authId = checked(await system.auth.admin.createUser({ email, password, email_confirm: true }), "create local test user").user.id;
  const department = checked(await system.from("departments").select("id").eq("code", "FT").single(), "find department");
  employeeId = checked(await system.from("employees").insert({
    employee_no: tag.toUpperCase().slice(0, 30), first_name: "Storage", last_name: "Test", email, department_id: department.id,
    role_id: "20000000-0000-0000-0000-000000000004", auth_user_id: authId,
  }).select("id").single(), "create local employee").id;
  checked(await user.auth.signInWithPassword({ email, password }), "sign in locally");
  const live = await issue(`${tag}-live`);
  const livePath = `${live}/live.txt`;
  await upload(user, "ncr-attachments", livePath);
  await register(live, livePath);
  const personas = checked(await system.from("employees").select("id,employee_no").in("employee_no", ["SBX-RB-STAFF", "SBX-PK-STAFF"]), "find personas");
  const rb = personas.find((p) => p.employee_no === "SBX-RB-STAFF").id;
  const pk = personas.find((p) => p.employee_no === "SBX-PK-STAFF").id;
  checked(await user.rpc("app_sandbox_enter", { p_persona_id: rb }), "enter sandbox");
  const trial = await issue(`${tag}-test`);
  const testPath = `${trial}/test.txt`;
  await upload(user, "ncr-test-attachments", testPath);
  await register(trial, testPath);
  const evidence = checked(await user.from("ncr_attachments").select("uploader_id,size_bytes").eq("ncr_id", trial).single(), "read test metadata");
  assert.equal(evidence.uploader_id, rb);
  assert.equal(evidence.size_bytes, payload.length);
  const signed = checked(await user.storage.from("ncr-test-attachments").createSignedUrl(testPath, 60), "sign test preview");
  const preview = await fetch(signed.signedUrl);
  assert.equal(preview.status, 200);
  assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), payload);
  assert.ok((await user.storage.from("ncr-attachments").download(livePath)).error, "sandbox cannot download live evidence");
  assert.ok((await user.storage.from("ncr-attachments").upload(`${trial}/wrong.txt`, payload)).error, "sandbox cannot upload to live bucket");
  console.log("PASS: upload, register, signed preview, and live/test isolation");

  const orphan = `${randomUUID()}/orphan.txt`;
  await upload(system, "ncr-test-attachments", orphan);
  checked(await user.rpc("app_sandbox_enter", { p_persona_id: pk }), "switch to unrelated persona");
  assert.ok((await user.storage.from("ncr-test-attachments").download(testPath)).error, "unrelated persona cannot download");
  const paths = checked(await user.rpc("app_sandbox_begin_ncr_file_cleanup"), "begin cleanup");
  assert.ok(paths.includes(testPath) && paths.includes(orphan));
  const premature = await user.rpc("app_sandbox_purge_ncr");
  assert.ok(premature.error?.message.includes("NCR_FILES_REMAIN"), "reports must survive until files are removed");
  checked(await user.storage.from("ncr-test-attachments").remove(paths), "remove all test files through Storage API");
  checked(await user.rpc("app_sandbox_purge_ncr"), "purge test reports");
  checked(await user.rpc("app_sandbox_finish_ncr_file_cleanup"), "close cleanup");
  assert.equal(checked(await system.from("ncr_attachments").select("id").eq("ncr_id", trial), "verify test metadata deletion").length, 0);
  assert.ok((await system.storage.from("ncr-test-attachments").download(orphan)).error, "orphan upload was removed");
  checked(await user.rpc("app_sandbox_exit"), "leave sandbox");
  const original = checked(await user.storage.from("ncr-attachments").download(livePath), "verify live file survived");
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), payload);
  console.log("PASS: persona scope, orphan cleanup via Storage API, and live evidence preservation");
} finally {
  // Only local fixtures from this run, using Storage API for actual file removal.
  for (const bucket of new Set(files.map(([b]) => b))) {
    checked(await system.storage.from(bucket).remove(files.filter(([b]) => b === bucket).map(([, p]) => p)), "cleanup local files");
  }
  if (reports.length) checked(await system.from("ncr_reports").delete().in("id", reports), "cleanup local reports");
  if (employeeId) checked(await system.from("employees").delete().eq("id", employeeId), "cleanup local employee");
  if (authId) checked(await system.auth.admin.deleteUser(authId), "cleanup local auth user");
}
