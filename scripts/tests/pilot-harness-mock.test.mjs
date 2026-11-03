import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createMockSupabase, mockSupabaseScript } from "../pilot-harness-mock.mjs";

const NOW = Date.UTC(2026, 10, 3, 3, 0, 0);
function mock(options = {}) {
  const warnings = [];
  const { client, db } = createMockSupabase({ now: () => NOW, warn: (message) => warnings.push(message), ...options });
  return { sb: client, db, warnings };
}
const decide = (sb, stepId, decision, comment = "") => sb.rpc("app_approval_decision", { p_step_id: stepId, p_decision: decision, p_comment: comment });
// คิว "รอฉันอนุมัติ" แบบเดียวกับ getPendingApprovals ใน app.js (ขั้นที่ pending และเป็นขั้นปัจจุบันของใบ ระบุตัวผู้ใช้จำลอง)
async function myQueue(sb) {
  const { data } = await sb.from("approval_steps").select("*,request:requests!inner(*)").eq("status", "pending").order("created_at", { ascending: true });
  return data.filter((step) => step.step_order === step.request.current_step && step.approver_employee_id === "e1");
}

test("?id= resolves each request, with its type, steps, history and attachments", async () => {
  const { sb } = mock();
  for (const [id, code] of [["req-mt-0412", "MT_REPAIR"], ["req-ncr-0088", "NCR_CAR"], ["req-it-0057", "IT_REPAIR"], ["req-mg-0019", "MANAGEMENT"]]) {
    const { data } = await sb.from("requests").select("*,request_type:request_types(code)").eq("id", id).maybeSingle();
    assert.equal(data.id, id);
    assert.equal(data.request_type.code, code);
    const { data: steps } = await sb.from("approval_steps").select("*").eq("request_id", id).order("step_order");
    assert.ok(steps.length >= 1 && steps.every((step, index) => step.step_order === index + 1 && step.step_name));
    const { data: history } = await sb.from("request_status_history").select("*").eq("request_id", id);
    assert.ok(history.some((row) => row.from_status === null && row.to_status === "pending_approval"));
  }
  const { data: missing } = await sb.from("requests").select("*").eq("id", "nope").maybeSingle();
  assert.equal(missing, null);
  const { data: files } = await sb.from("request_attachments").select("*").eq("request_id", "req-mt-0412").order("created_at");
  assert.equal(files.length, 2);
  const paths = [files[0].storage_path, `${files[0].storage_path}.thumb.jpg`, "unknown/path.png"];
  const { data: signed } = await sb.storage.from("request-attachments").createSignedUrls(paths, 60);
  assert.deepEqual(signed.map((item) => item.path), paths);
  assert.match(signed[0].signedUrl, /^data:image\/svg\+xml/);
  assert.equal(signed[1].signedUrl, signed[0].signedUrl);
  assert.equal(signed[2].signedUrl, null);
});

test("the mock employee is an MT department manager with two approvals and mixed repair work", async () => {
  const { sb } = mock();
  const { data: me } = await sb.from("employees").select("*").eq("auth_user_id", "u1").eq("is_active", true).maybeSingle();
  assert.equal(me.role.code, "department_manager");
  const { data: mtType } = await sb.from("request_types").select("*").eq("code", "MT_REPAIR").maybeSingle();
  assert.equal(mtType.owning_department_id, me.department_id);
  assert.deepEqual((await myQueue(sb)).map((step) => step.request.request_no), ["NCR-2569-0088", "MT-2569-0412"]);
  const { data: repairs } = await sb.from("requests").select("*").in("status", ["pending_assign", "assigned", "in_progress", "pending_verify"]).order("created_at", { ascending: true });
  assert.deepEqual(repairs.map((row) => row.status), ["pending_verify", "in_progress", "assigned", "pending_assign"]);
  assert.ok(repairs.find((row) => row.status === "assigned").request_technicians.some((row) => row.technician_id === "e1"));
});

test("approving an intermediate step moves current_step without a history row and leaves the queue", async () => {
  const { sb, db } = mock();
  const historyBefore = db.request_status_history.length;
  assert.equal((await decide(sb, "req-ncr-0088-s2", "approved", "รับทราบ")).error, null);
  const { data: request } = await sb.from("requests").select("*").eq("id", "req-ncr-0088").maybeSingle();
  assert.equal(request.status, "pending_approval");
  assert.equal(request.current_step, 3);
  const { data: step } = await sb.from("approval_steps").select("*").eq("id", "req-ncr-0088-s2").maybeSingle();
  assert.deepEqual([step.status, step.acted_by, step.comment, typeof step.acted_at], ["approved", "e1", "รับทราบ", "string"]);
  assert.equal(db.request_status_history.length, historyBefore);
  assert.deepEqual((await myQueue(sb)).map((row) => row.request_id), ["req-mt-0412"]);
  assert.equal((await decide(sb, "req-ncr-0088-s2", "approved")).error.message, "STEP_NOT_PENDING");
});

test("approving the last repair step sends it to pending_assign and records history", async () => {
  const { sb } = mock();
  assert.equal((await decide(sb, "req-mt-0412-s2", "approved")).error, null);
  const { data: request } = await sb.from("requests").select("*").eq("id", "req-mt-0412").maybeSingle();
  assert.equal(request.status, "pending_assign");
  const { data: history } = await sb.from("request_status_history").select("*").eq("request_id", "req-mt-0412").order("created_at", { ascending: false }).limit(1);
  assert.deepEqual([history[0].from_status, history[0].to_status, history[0].changed_by], ["pending_approval", "pending_assign", "e1"]);
  const { count } = await sb.from("requests").select("id", { count: "exact", head: true }).eq("status", "pending_assign");
  assert.equal(count, 2);
});

test("decisions are checked: comment required, someone else's step, not the current step", async () => {
  const { sb } = mock();
  assert.equal((await decide(sb, "req-mt-0412-s2", "rejected", "")).error.message, "COMMENT_REQUIRED");
  assert.equal((await decide(sb, "req-it-0057-s2", "approved")).error.message, "NOT_AUTHORIZED");
  assert.equal((await decide(sb, "req-ncr-0088-s3", "approved")).error.message, "STEP_NOT_CURRENT");
  assert.equal((await decide(sb, "req-mt-0412-s2", "acknowledged")).error.message, "INVALID_DECISION");
  assert.equal((await decide(sb, "req-mt-0412-s2", "rejected", "ไม่ใช่งานซ่อม ส่งแผนกผลิตแก้เอง")).error, null);
  const { data } = await sb.from("requests").select("*").eq("id", "req-mt-0412").maybeSingle();
  assert.equal(data.status, "rejected");
});

test("more_info then resubmit returns the step to the queue", async () => {
  const { sb, db } = mock();
  // ใบที่ผู้ใช้จำลองยื่นเอง: สร้างใหม่ ขั้นแรกเป็นของผู้ใช้จำลอง
  const { data: types } = await sb.from("request_types").select("*").eq("code", "IT_REPAIR");
  const { data: id } = await sb.rpc("app_create_request", { p_type_id: types[0].id, p_title: "เมาส์เสีย", p_description: "คลิกขวาไม่ติด", p_priority: "low", p_details: {}, p_cc_department_ids: [] });
  const step = db.approval_steps.find((row) => row.request_id === id && row.step_order === 1);
  assert.equal((await decide(sb, step.id, "more_info", "ขอรหัสอุปกรณ์")).error, null);
  assert.equal(db.requests.find((row) => row.id === id).status, "more_info");
  assert.equal((await sb.rpc("app_resubmit_request", { p_request_id: id, p_comment: "PC-MT-07" })).error, null);
  const request = db.requests.find((row) => row.id === id);
  assert.deepEqual([request.status, request.current_step, step.status], ["pending_approval", 1, "pending"]);
  assert.deepEqual(db.request_status_history.filter((row) => row.request_id === id).map((row) => [row.from_status, row.to_status, row.note]),
    [[null, "pending_approval", null], ["pending_approval", "more_info", "ขอรหัสอุปกรณ์"], ["more_info", "pending_approval", "PC-MT-07"]]);
  assert.equal((await sb.rpc("app_resubmit_request", { p_request_id: id })).error.message, "REQUEST_NOT_AWAITING_INFO");
});

test("general requests take app_update_request_status approved → in_progress → completed only", async () => {
  const { sb, db } = mock();
  const { data: types } = await sb.from("request_types").select("*").eq("code", "IT_REPAIR");
  const { data: id } = await sb.rpc("app_create_request", { p_type_id: types[0].id, p_title: "ขอสิทธิ์ ERP", p_description: "ขอสิทธิ์ดูรายงานคลัง" });
  assert.equal((await sb.rpc("app_update_request_status", { p_request_id: id, p_status: "in_progress" })).error.message, "INVALID_TRANSITION");
  db.requests.find((row) => row.id === id).status = "approved";
  assert.equal((await sb.rpc("app_update_request_status", { p_request_id: id, p_status: "in_progress" })).error, null);
  assert.equal((await sb.rpc("app_update_request_status", { p_request_id: id, p_status: "completed" })).error, null);
  assert.equal(db.requests.find((row) => row.id === id).status, "completed");
  assert.equal((await sb.rpc("app_update_request_status", { p_request_id: "req-mt-0405", p_status: "in_progress" })).error.message, "INVALID_TRANSITION");
});

test("MT form: repair departments, machines, doc number, and the new request shows up in reads", async () => {
  const { sb } = mock();
  const { data: departments } = await sb.from("departments").select("id,code,name_th").eq("is_active", true).eq("is_repair_site", true).order("code");
  assert.deepEqual(departments.map((row) => row.code), ["MT", "QA", "RB"]);
  const { data: machines } = await sb.from("machines").select("*").eq("is_active", true).order("sort_order");
  assert.ok(machines.length >= 6);
  const rb = departments.find((row) => row.code === "RB");
  assert.equal((await sb.rpc("app_peek_repair_doc_number", { p_department_id: rb.id })).data, "MT-2569-0413");
  const machine = machines.find((row) => row.department_id === rb.id);
  const wrongMachine = machines.find((row) => row.department_id !== rb.id);
  const args = { p_department_id: rb.id, p_machine_id: wrongMachine.id, p_doc_type: "repair", p_description: "ฮีตเตอร์ไม่ร้อน", p_is_urgent: true, p_needed_date: null, p_requester_name: "" };
  assert.equal((await sb.rpc("app_create_repair_request", args)).error.message, "MACHINE_NOT_FOUND");
  const { data: id, error } = await sb.rpc("app_create_repair_request", { ...args, p_machine_id: machine.id });
  assert.equal(error, null);
  const { data: created } = await sb.from("requests").select("*").eq("id", id).maybeSingle();
  assert.deepEqual([created.request_no, created.status, created.machine_code, created.request_type.code], ["MT-2569-0413", "pending_approval", machine.code, "MT_REPAIR"]);
  const { data: list } = await sb.from("requests").select("*").order("created_at", { ascending: false }).limit(1);
  assert.equal(list[0].id, id);
  assert.ok((await myQueue(sb)).some((step) => step.request_id === id));
  assert.equal((await sb.rpc("app_peek_repair_doc_number", {})).data, "MT-2569-0414");
});

test("repair workflow: assign, start, finish, verify", async () => {
  const { sb, db } = mock();
  const id = "req-mt-0405";
  assert.equal((await sb.rpc("app_start_repair_work", { p_request_id: id })).error.message, "INVALID_TRANSITION");
  assert.equal((await sb.rpc("app_assign_repair_technician", { p_request_id: id, p_technician_ids: ["e2", "e8"], p_execution_plan: "immediate" })).error, null);
  const { data: techs } = await sb.from("request_technicians").select("technician_id").eq("request_id", id);
  assert.deepEqual(techs.map((row) => row.technician_id), ["e2", "e8"]);
  await sb.rpc("app_start_repair_work", { p_request_id: id });
  await sb.rpc("app_finish_repair_work", { p_request_id: id, p_cause_analysis: "สายพานเก่า", p_parts_used_items: [] });
  assert.equal(db.requests.find((row) => row.id === id).status, "pending_verify");
  // ผู้แจ้งใบนี้คือ e4 ผู้ใช้จำลองตรวจรับไม่ได้
  assert.equal((await sb.rpc("app_verify_repair", { p_request_id: id, p_result: "pass" })).error.message, "NOT_AUTHORIZED");
  assert.equal((await sb.rpc("app_verify_repair", { p_request_id: "req-mt-0390", p_result: "pass", p_note: "ไฟติดครบ" })).error, null);
  assert.equal(db.requests.find((row) => row.id === "req-mt-0390").status, "completed");
  assert.equal(db.request_verifications.length, 1);
});

test("query coverage: head counts, in, not/is, ilike, order and limit", async () => {
  const { sb } = mock();
  const { count, data } = await sb.from("requests").select("id", { count: "exact", head: true }).eq("requester_id", "e1");
  assert.equal(data, null);
  assert.equal(count, 3);
  assert.equal((await sb.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_id", "e1").is("read_at", null)).count, 2);
  await sb.from("notifications").update({ read_at: new Date(NOW).toISOString() }).eq("recipient_id", "e1").is("read_at", null);
  assert.equal((await sb.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null)).count, 0);
  const { data: like } = await sb.from("requests").select("*").ilike("request_no", "%MT-2569-04_2%");
  assert.deepEqual(like.map((row) => row.id), ["req-mt-0412"]);
  const { data: escaped } = await sb.from("requests").select("*").ilike("request_no", "%\\%%");
  assert.deepEqual(escaped, []);
  const { data: firstTwo } = await sb.from("requests").select("*").order("created_at", { ascending: false }).limit(2);
  assert.deepEqual(firstTwo.map((row) => row.id), ["req-mt-0412", "req-ncr-0088"]);
  const { data: withStep } = await sb.from("approval_steps").select("*").not("acted_by", "is", null).eq("request_id", "req-ncr-0088");
  assert.deepEqual(withStep.map((row) => row.id), ["req-ncr-0088-s1"]);
  // ผลที่อ่านได้เป็นสำเนา แก้แล้วไม่กระทบข้อมูลในหน่วยความจำ
  firstTwo[0].status = "completed";
  assert.equal((await sb.from("requests").select("*").eq("id", "req-mt-0412").maybeSingle()).data.status, "pending_approval");
});

test("unknown tables, filters and RPCs warn once and return empty", async () => {
  const { sb, warnings } = mock();
  assert.deepEqual((await sb.from("no_such_table").select("*")).data, []);
  await sb.from("no_such_table").select("*");
  assert.deepEqual((await sb.from("requests").select("*").textSearch("title", "x").textSearch("title", "y")).data.length, 8);
  assert.equal((await sb.rpc("app_no_such_rpc")).data, null);
  await sb.rpc("app_no_such_rpc");
  assert.equal(warnings.length, 3);
});

test("?empty=1 has no requests but keeps the form fixtures", async () => {
  const { sb } = mock({ empty: true });
  assert.deepEqual((await sb.from("requests").select("*")).data, []);
  assert.deepEqual((await sb.from("approval_steps").select("*").eq("status", "pending")).data, []);
  assert.equal((await sb.from("notifications").select("id", { count: "exact", head: true })).count, 0);
  assert.ok((await sb.from("machines").select("*")).data.length >= 6);
});

test("the served script is self-contained: installs window.supabase and stubs cross-origin fetch", async () => {
  const calls = [];
  const window = {
    navigator: {}, location: { search: "?empty=1", href: "http://localhost:5181/pilot-shell.html", origin: "http://localhost:5181" },
    console: { warn: () => {} }, URL, URLSearchParams, Response,
    fetch(input) { calls.push(String(input)); return Promise.resolve(new Response("same")); },
  };
  vm.runInNewContext(mockSupabaseScript(), { window });
  assert.equal(typeof window.supabase.createClient, "function");
  assert.equal(window.createMockSupabase, undefined);
  const sb = window.supabase.createClient();
  assert.equal((await sb.from("requests").select("id", { count: "exact", head: true })).count, 0);
  assert.equal(await (await window.fetch("https://script.google.com/macros/x")).text(), "{}");
  assert.equal(await (await window.fetch("/modules/x.js")).text(), "same");
  assert.deepEqual(calls, ["/modules/x.js"]);
  assert.equal(typeof window.navigator.serviceWorker.register, "function");
});
