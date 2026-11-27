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
  assert.deepEqual([request.status, request.current_step, typeof request.approved_at], ["pending_assign", 0, "string"]);
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
  assert.equal((await decide(sb, "req-mt-0412-s2", "acknowledged")).error.message, "DECISION_NOT_ALLOWED");
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
  assert.equal((await sb.rpc("app_update_request_status", { p_request_id: "req-mt-0405", p_status: "in_progress" })).error.message, "REPAIR_USES_OWN_WORKFLOW");
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
  assert.equal((await sb.rpc("app_start_repair_work", { p_request_id: id })).error.message, "REQUEST_NOT_ASSIGNED");
  assert.equal((await sb.rpc("app_assign_repair_technician", { p_request_id: id, p_technician_ids: ["e2", "e8"], p_execution_plan: "immediate" })).error, null);
  const { data: techs } = await sb.from("request_technicians").select("technician_id").eq("request_id", id);
  assert.deepEqual(techs.map((row) => row.technician_id), ["e2", "e8"]);
  await sb.rpc("app_start_repair_work", { p_request_id: id });
  await sb.rpc("app_finish_repair_work", { p_request_id: id, p_cause_analysis: "สายพานเก่า", p_parts_used_items: [] });
  assert.equal(db.requests.find((row) => row.id === id).status, "pending_verify");
  // ผู้แจ้งใบนี้คือ e4 ผู้ใช้จำลองตรวจรับไม่ได้
  assert.equal((await sb.rpc("app_verify_repair", { p_request_id: id, p_result: "pass" })).error.message, "NOT_AUTHORIZED");
  assert.equal((await sb.rpc("app_verify_repair", { p_request_id: "req-mt-0390", p_result: "fail" })).error.message, "NOTE_REQUIRED");
  assert.equal((await sb.rpc("app_verify_repair", { p_request_id: "req-mt-0390", p_result: "pass", p_note: "ไฟติดครบ" })).error, null);
  assert.equal(db.requests.find((row) => row.id === "req-mt-0390").status, "completed");
  assert.equal(db.request_verifications.length, 1);
});

test("query coverage: head counts, in, not/is, ilike, order and limit", async () => {
  const { sb } = mock();
  const { count, data } = await sb.from("requests").select("id", { count: "exact", head: true }).eq("requester_id", "e1");
  assert.equal(data, null);
  assert.equal(count, 4);
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
  assert.deepEqual((await sb.from("requests").select("*").textSearch("title", "x").textSearch("title", "y")).data.length, 9);
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
  // เส้นทางเขียนผ่านสคริปต์ที่เสิร์ฟจริง: จับการอ้างตัวแปรนอกฟังก์ชันใน RPC ด้วย
  const { data: id, error } = await sb.rpc("app_create_repair_request", { p_department_id: "dep-rb", p_machine_id: "m-hcm03", p_description: "เครื่องหยุดเอง" });
  assert.equal(error, null);
  const { data: steps } = await sb.from("approval_steps").select("*").eq("request_id", id);
  assert.equal((await sb.rpc("app_approval_decision", { p_step_id: steps[0].id, p_decision: "approved", p_comment: "" })).error, null);
  assert.equal((await sb.from("requests").select("*").eq("id", id).maybeSingle()).data.status, "pending_assign");
  assert.equal(await (await window.fetch("https://script.google.com/macros/x")).text(), "{}");
  assert.equal(await (await window.fetch("/modules/x.js")).text(), "same");
  assert.deepEqual(calls, ["/modules/x.js"]);
  assert.equal(typeof window.navigator.serviceWorker.register, "function");
});

test("?ncr=1 has only NCRs, one per step, and each role moves an NCR to the next role through the app_ncr_* RPCs", async () => {
  // storage แชร์ระหว่าง mock แต่ละตัว = สลับผู้ใช้ด้วย ?as= แล้วโหลดหน้าใหม่ ใบยังเดินต่อจากเดิม
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
  const as = (id) => mock({ ncr: true, as: id, storage });
  const first = as("e5");
  assert.equal(first.db.requests.length, 0, "no requests other than NCR");
  const { data: statuses } = await first.sb.from("ncr_reports").select("status");
  assert.deepEqual([...new Set(statuses.map((row) => row.status))].sort(), ["awaiting_disposition", "awaiting_followup", "awaiting_info", "awaiting_response", "awaiting_signoff", "closed"]);
  const { data: me } = await first.sb.from("employees").select("*").eq("auth_user_id", (await first.sb.auth.getSession()).data.session.user.id).maybeSingle();
  assert.equal(me.id, "e5", "?as= signs in as that employee");

  const id = "ncr-QA060-26";
  const status = async (sb) => (await sb.from("ncr_reports").select("*").eq("id", id).maybeSingle()).data;
  const call = async (who, name, args) => (await as(who).sb.rpc(name, { p_ncr_id: id, ...args })).error?.message ?? null;
  assert.equal(await call("e9", "app_ncr_dispose", { p_dispositions: ["sort"], p_department_ids: ["dep-rb"] }), "NOT_AUTHORIZED", "only the factory manager disposes");
  assert.equal(await call("e5", "app_ncr_dispose", { p_dispositions: ["sort"], p_department_ids: ["dep-rb", "dep-mt"], p_responder_ids: ["e9"] }), null);
  let row = await status(as("e1").sb);
  assert.equal(row.status, "awaiting_response");
  assert.deepEqual(row.ncr_responsibilities.map((item) => [item.department.code, item.responder_id, item.share]), [["RB", "e9", 0.5], ["MT", null, 0.5]]);
  assert.equal(await call("e10", "app_ncr_respond", { p_causes: ["machine"], p_root_cause: "สึก", p_correction: "ปรับ", p_prevention: "" }), "NOT_AUTHORIZED", "a named responder shuts out the rest of RB");
  assert.equal(await call("e9", "app_ncr_respond", { p_causes: ["machine"], p_root_cause: "สึก", p_correction: "ปรับ", p_prevention: "" }), null);
  assert.equal(await call("e3", "app_ncr_followup", { p_result: "close" }), "NCR_PREVENTION_REQUIRED");
  assert.equal(await call("e9", "app_ncr_submit_prevention", { p_prevention: "ตรวจแม่พิมพ์ทุกกะ" }), null);
  assert.equal(await call("e3", "app_ncr_followup", { p_result: "close" }), null);
  assert.equal(await call("e5", "app_ncr_signoff", {}), "NOT_AUTHORIZED", "QA signs first");
  assert.equal(await call("e11", "app_ncr_signoff", {}), null);
  assert.equal(await call("e5", "app_ncr_request_info", { p_note: "ขอผลวัดซ้ำ" }), null);
  assert.equal((await status(as("e9").sb)).status, "awaiting_info");
  assert.equal(await call("e9", "app_ncr_answer_info", { p_note: "แนบผลวัดซ้ำแล้ว" }), null);
  assert.equal(await call("e5", "app_ncr_signoff", {}), null);
  assert.equal(await call("e7", "app_ncr_signoff", {}), null);
  row = await status(as("e3").sb);
  assert.equal(row.status, "closed");
  const { data: history } = await as("e3").sb.from("ncr_status_history").select("*").eq("ncr_id", id).order("id");
  assert.deepEqual(history.map((entry) => entry.action), ["issue", "dispose", "respond", "followup_close", "signoff_qa", "request_info", "answer_info", "signoff_factory", "signoff_gm"]);

  const issued = (await as("e1").sb.rpc("app_ncr_issue", { p_product_name: "ยางทดสอบ", p_qty_total: 10, p_qty_defect: 2, p_unit: "ชิ้น", p_source: "in_process", p_defect_type_code: "dimension", p_description: "ทดสอบออกใบใหม่" })).data;
  assert.equal(issued.ncr_no, "QA062/26");
  assert.equal((await as("e5").sb.from("ncr_reports").select("*").eq("id", issued.id).maybeSingle()).data.status, "awaiting_disposition");
  assert.equal(mock({ as: "e5" }).db.employees.find((row) => row.id === "e1").auth_user_id, "u1", "?as= only applies to the NCR scenario");
});

// ราคาวัตถุดิบ (เคมี + ของซื้อ) และต้นทุนการผลิต (app_rf_prices / app_rf_price_save / app_rf_cost_data): สิทธิ์ตามแผนก/ตำแหน่งของบัญชีทดสอบ · ตรวจข้อมูลเหมือนฐานข้อมูล · ราคาสาธิตและประวัติ
test("cost RPCs: permissions follow the acting persona, prices are append-only history, validation answers RF_INVALID_PRICE", async () => {
  const { client: sb, rf, bom } = createMockSupabase({ sandbox: true, now: () => NOW });
  const as = async (id) => { assert.equal((await sb.rpc("app_sandbox_enter", { p_persona_id: id })).error, null); };
  const error = async (name, args) => (await sb.rpc(name, args)).error?.message ?? null;
  // ของซื้อของ BOM (ชนิด PURCHASED) ก่อนโหลดราคาครั้งแรก: ราคาสาธิตของซื้อใส่ให้ 2 ใน 3 ชิ้น (เรียงตามรหัส ชิ้นที่สามยังไม่มีราคา) ชิ้นงานชนิดอื่นไม่ได้ราคา
  bom.edit((current) => {
    current.items.push({ code: "P-A", kind: "PURCHASED", name: "ของซื้อ A", uom: "pcs" }, { code: "P-B", kind: "PURCHASED", name: "ของซื้อ B", uom: "kg" }, { code: "P-C", kind: "PURCHASED", name: "ของซื้อ C", uom: "m" }, { code: "FG-1", kind: "FG", name: "สินค้า", uom: "pcs" });
  });
  rf.edit((current) => {
    current.materials.push({ code: "ZNO", name: "ซิงค์ออกไซด์", category: "สารกระตุ้น" });
    current.recipes.push({ id: "RC-1", revision: 2, status: "approved", productCode: "FG-1", batchKg: 10, items: [{ materialCode: "ZNO", stage: 1, kg: 10, unit: "kg", phr: 0 }] });
    current.requisitions.push({ id: "REQ-1", orderId: "WO-1", recipeId: "RC-1", recipeRevision: 2, batches: 1, status: "consumed", issuedAt: NOW - 1000, lines: [{ materialCode: "ZNO", stage: 1, lotNo: "L1", targetKg: 10, actualKg: 10.2, weighedAt: NOW - 2000 }] });
    current.lots.push({ id: "MX-1", stage: "mixing", orderId: "WO-1", recipeId: "RC-1", createdAt: NOW - 500, sources: [{ type: "requisition", id: "REQ-1" }], params: { batches: 1 } }, { id: "EX-1", stage: "extrusion", createdAt: NOW });
  });
  // admin (บัญชีแรก): เห็นทุกอย่างและบันทึกราคาได้ · ราคาสาธิตมีประวัติ ZNO สองแถว และ DM-CH-05 / DM-FIL-C ยังไม่มีราคา
  const first = (await sb.rpc("app_rf_prices", {})).data;
  assert.equal(first.canWrite, true);
  assert.ok(first.prices.filter((row) => row.materialCode === "ZNO").length >= 2, "history of one material");
  for (const code of ["DM-RUB-A", "DM-RUB-B", "DM-FIL-A", "DM-FIL-B", "DM-PLS-A", "DM-OIL-A", "DM-CH-01", "DM-CH-02", "DM-CH-03", "DM-CH-04", "DM-CH-06", "DM-CH-07", "DM-CH-08", "DM-CH-09", "DM-CH-10", "DM-CH-11", "DM-CH-12", "DM-CH-13", "EPDM-55", "S-80"]) assert.ok(first.prices.some((row) => row.materialCode === code), `${code} has a demo price`);
  assert.ok(!first.prices.some((row) => ["DM-CH-05", "DM-FIL-C"].includes(row.materialCode)), "the no-price state stays visible");
  assert.ok(first.prices.every((row) => row.id && ["chem", "part"].includes(row.kind) && typeof row.unitPrice === "number" && /^\d{4}-\d{2}-\d{2}$/.test(row.effectiveFrom) && Number.isFinite(row.createdAt) && typeof row.createdBy === "string"));
  assert.deepEqual(first.prices.filter((row) => row.kind === "part").map((row) => row.materialCode), ["P-A", "P-B"], "demo part prices: the third part has none, FG items never");
  assert.ok(first.prices.filter((row) => row.kind === "chem").every((row) => !row.materialCode.startsWith("P-")));
  const saved = (await sb.rpc("app_rf_price_save", { p_kind: "chem", p_material_code: "DM-CH-05", p_unit_price: 125.5, p_effective_from: "2026-11-03", p_note: "  ใบเสนอราคา " })).data;
  assert.equal(saved.prices.length, first.prices.length + 1);
  const row = saved.prices.at(-1);
  assert.deepEqual([row.kind, row.materialCode, row.unitPrice, row.effectiveFrom, row.note], ["chem", "DM-CH-05", 125.5, "2026-11-03", "ใบเสนอราคา"]);
  const zno = first.prices.filter((entry) => entry.materialCode === "ZNO");
  await sb.rpc("app_rf_price_save", { p_kind: "chem", p_material_code: "ZNO", p_unit_price: 99, p_effective_from: zno[0].effectiveFrom, p_note: "" });
  assert.equal((await sb.rpc("app_rf_prices", {})).data.prices.length, first.prices.length + 2, "a correction is a new row, old rows stay");
  // เหมือนฐานข้อมูล: บันทึกซ้ำด้วยราคาและหมายเหตุเดียวกับแถวล่าสุดของวัตถุดิบและวันที่มีผลเดียวกัน = ไม่เพิ่มแถว
  await sb.rpc("app_rf_price_save", { p_kind: "chem", p_material_code: "ZNO", p_unit_price: 99, p_effective_from: zno[0].effectiveFrom, p_note: " " });
  assert.equal((await sb.rpc("app_rf_prices", {})).data.prices.length, first.prices.length + 2, "saving the same price and note again adds no row");
  await sb.rpc("app_rf_price_save", { p_kind: "chem", p_material_code: "ZNO", p_unit_price: 99, p_effective_from: zno[0].effectiveFrom, p_note: "ยืนยันราคา" });
  assert.equal((await sb.rpc("app_rf_prices", {})).data.prices.length, first.prices.length + 3, "a different note is a new row");
  // ตรวจข้อมูล
  const ok = { p_kind: "chem", p_material_code: "ZNO", p_unit_price: 10, p_effective_from: "2026-11-03", p_note: "" };
  for (const bad of [{ p_material_code: "NOPE" }, { p_material_code: null }, { p_kind: null }, { p_kind: "other" }, { p_kind: "part" }, { p_kind: "part", p_material_code: "FG-1" }, { p_kind: "chem", p_material_code: "P-A" }, { p_unit_price: 0 }, { p_unit_price: -1 }, { p_unit_price: 10000001 }, { p_unit_price: 1.23456 }, { p_unit_price: "10" }, { p_effective_from: null }, { p_effective_from: "03/11/2026" }, { p_effective_from: "2026-02-31" }, { p_effective_from: "2028-01-01" }, { p_note: "x".repeat(301) }]) {
    assert.equal(await error("app_rf_price_save", { ...ok, ...bad }), "RF_INVALID_PRICE", JSON.stringify(bad));
  }
  assert.equal(await error("app_rf_price_save", { ...ok, p_unit_price: 10000000, p_effective_from: "2027-11-03", p_note: "x".repeat(300) }), null, "the limits themselves are accepted (366 days ahead)");
  // ของซื้อ: บันทึกราคาต่อหน่วยของชิ้น (kind part) · ไม่ปนกับเคมี · ซ้ำ (ชนิด + รหัส + วัน + ราคา + หมายเหตุ) ไม่เพิ่มแถว
  const partSave = { p_kind: "part", p_material_code: "P-C", p_unit_price: 7.25, p_effective_from: "2026-11-03", p_note: "ใบเสนอราคา" };
  const partSaved = (await sb.rpc("app_rf_price_save", partSave)).data;
  assert.equal(partSaved.prices.at(-1).kind, "part");
  assert.deepEqual(partSaved.prices.filter((entry) => entry.materialCode === "P-C").map((entry) => [entry.kind, entry.unitPrice]), [["part", 7.25]]);
  await sb.rpc("app_rf_price_save", partSave);
  assert.equal((await sb.rpc("app_rf_prices", {})).data.prices.filter((entry) => entry.materialCode === "P-C").length, 1, "the same part price again adds no row");
  await sb.rpc("app_rf_price_save", { ...partSave, p_kind: "chem", p_material_code: "ZNO" });
  assert.ok((await sb.rpc("app_rf_prices", {})).data.prices.some((entry) => entry.kind === "chem" && entry.materialCode === "ZNO" && entry.unitPrice === 7.25), "the same date and price on a chemical is its own row");
  // ต้นทุน: สูตรทุก revision · ล็อตผสมพร้อมใบเบิก (ล็อตสถานีอื่นไม่มี)
  const cost = (await sb.rpc("app_rf_cost_data", {})).data;
  assert.deepEqual(cost.materials, [{ code: "ZNO", name: "ซิงค์ออกไซด์", category: "สารกระตุ้น" }]);
  assert.deepEqual(cost.recipes.map((entry) => [entry.id, entry.revision, entry.status, entry.productCode, entry.batchKg]), [["RC-1", 2, "approved", "FG-1", 10]]);
  assert.equal(cost.lots.length, 1);
  assert.deepEqual(cost.lots[0], { lotNo: "MX-1", orderId: "WO-1", recipeId: "RC-1", recipeRevision: 2, batches: 1, createdAt: NOW - 500, requisitions: [{ id: "REQ-1", issuedAt: NOW - 1000, lines: [{ materialCode: "ZNO", stage: 1, targetKg: 10, actualKg: 10.2, weighedAt: NOW - 2000 }] }] });
  assert.ok(cost.prices.length > first.prices.length);
  // ใครทำอะไรได้ (ตรงกับฐานข้อมูล): [บัญชี, เห็นราคา, บันทึกราคา, เห็นต้นทุน]
  const matrix = [
    ["persona-st", true, true, false], ["persona-sth", true, true, false], ["persona-pp", true, false, true], ["persona-fm", true, false, true], ["persona-gm", true, false, true],
    ["persona-afm", false, false, false], ["persona-rb", false, false, false], ["persona-rbh", false, false, false], ["persona-wh", false, false, false], ["persona-sa", false, false, false], ["persona-qah", false, false, false],
  ];
  for (const [persona, prices, write, seeCost] of matrix) {
    await as(persona);
    const read = await sb.rpc("app_rf_prices", {});
    assert.equal(read.error?.message ?? null, prices ? null : "RF_FORBIDDEN", `${persona} prices`);
    if (prices) assert.equal(read.data.canWrite, write, `${persona} canWrite`);
    assert.equal(await error("app_rf_price_save", ok), write ? null : "RF_FORBIDDEN", `${persona} save`);
    assert.equal(await error("app_rf_cost_data", {}), seeCost ? null : "RF_FORBIDDEN", `${persona} cost`);
  }
});

// ค่าแรง (เฟส 2 · app_rf_labour / app_rf_labour_rate_save / app_rf_station_standard_save) และต้นทุนต่อหน่วยของชิ้นงาน BOM: สิทธิ์ตามบัญชีที่ทำหน้าที่อยู่ ตรงกับฐานข้อมูล
test("labour RPCs: rates for cost viewers only, time standards for cost viewers and RB, append-only history, validation", async () => {
  const { client: sb, rf } = createMockSupabase({ sandbox: true, now: () => NOW });
  const as = async (id) => { assert.equal((await sb.rpc("app_sandbox_enter", { p_persona_id: id })).error, null); };
  const error = async (name, args) => (await sb.rpc(name, args)).error?.message ?? null;
  rf.edit((current) => {
    current.materials.push({ code: "ZNO", name: "ซิงค์ออกไซด์", category: "สารกระตุ้น" });
    current.recipes.push({ id: "RC-1", revision: 1, status: "approved", productCode: "FG-1", batchKg: 10, items: [{ materialCode: "ZNO", stage: 1, kg: 10, unit: "kg", phr: 0 }] });
  });
  const steps = ["prep", "mix1", "mix2", "mix3", "extrusion", "curing", "finishing"].map((step, index) => ({ step, minutes: index + 1, workers: 2 }));
  const first = (await sb.rpc("app_rf_labour", {})).data;
  assert.deepEqual([first.canSeeRates, first.canWriteRates, first.canWriteStandards], [true, true, true]);
  assert.ok(first.rates.filter((row) => row.departmentCode === "RB").length >= 2, "the demo data has a rate history for RB");
  const okRate = { p_department_code: "RB", p_rate_per_hour: 61.25, p_effective_from: "2026-11-03", p_note: " ปรับ " };
  const saved = (await sb.rpc("app_rf_labour_rate_save", okRate)).data;
  assert.equal(saved.rates.length, first.rates.length + 1);
  assert.deepEqual([saved.rates.at(-1).ratePerHour, saved.rates.at(-1).note], [61.25, "ปรับ"]);
  assert.equal((await sb.rpc("app_rf_labour_rate_save", okRate)).data.rates.length, first.rates.length + 1, "the same rate again adds no row");
  for (const bad of [{ p_department_code: "ST" }, { p_department_code: null }, { p_rate_per_hour: 0 }, { p_rate_per_hour: -1 }, { p_rate_per_hour: 100001 }, { p_rate_per_hour: 1.234 }, { p_rate_per_hour: "60" },
    { p_effective_from: "2026-13-01" }, { p_effective_from: null }, { p_effective_from: "1999-12-31" }, { p_effective_from: "2028-01-01" }, { p_note: "x".repeat(301) }]) {
    assert.equal(await error("app_rf_labour_rate_save", { ...okRate, ...bad }), "RF_INVALID_LABOUR", JSON.stringify(bad));
  }
  const okStd = { p_product_code: "FG-1", p_effective_from: "2026-11-03", p_steps: steps, p_note: "" };
  const std = (await sb.rpc("app_rf_station_standard_save", okStd)).data;
  assert.deepEqual(std.standards.at(-1).steps, steps);
  assert.equal((await sb.rpc("app_rf_station_standard_save", okStd)).data.standards.length, std.standards.length, "the same standard again adds no row");
  assert.equal((await sb.rpc("app_rf_station_standard_save", { ...okStd, p_note: "จับเวลาใหม่" })).data.standards.length, std.standards.length + 1, "a correction is a new row");
  const withStep = (index, change) => steps.map((row, at) => (at === index ? { ...row, ...change } : row));
  for (const bad of [{ p_product_code: "FG-NONE" }, { p_product_code: "" }, { p_product_code: null }, { p_effective_from: "2028-01-01" }, { p_effective_from: null }, { p_note: "x".repeat(301) },
    { p_steps: null }, { p_steps: {} }, { p_steps: steps.slice(0, 6) }, { p_steps: withStep(6, { step: "prep" }) }, { p_steps: withStep(6, { step: "packing" }) }, { p_steps: withStep(0, { minutes: -1 }) },
    { p_steps: withStep(0, { minutes: 100001 }) }, { p_steps: withStep(0, { minutes: 1.234 }) }, { p_steps: withStep(0, { minutes: "10" }) }, { p_steps: withStep(0, { workers: 1001 }) },
    { p_steps: withStep(0, { workers: null }) }, { p_steps: steps.map((row) => ({ ...row, minutes: 0 })) }, { p_steps: [1, 2, 3, 4, 5, 6, 7] }]) {
    assert.equal(await error("app_rf_station_standard_save", { ...okStd, ...bad }), "RF_INVALID_STANDARD", JSON.stringify(bad).slice(0, 80));
  }
  // [บัญชี, อ่าน, เห็น/แก้อัตรา, แก้เวลามาตรฐาน]
  const matrix = [
    ["persona-pp", true, true, true], ["persona-fm", true, true, true], ["persona-gm", true, true, true],
    ["persona-rb", true, false, false], ["persona-rbh", true, false, true],
    ["persona-afm", false, false, false], ["persona-st", false, false, false], ["persona-sth", false, false, false], ["persona-grh", false, false, false],
    ["persona-wh", false, false, false], ["persona-sa", false, false, false], ["persona-qah", false, false, false],
  ];
  for (const [persona, read, rates, standards] of matrix) {
    await as(persona);
    const got = await sb.rpc("app_rf_labour", {});
    assert.equal(got.error?.message ?? null, read ? null : "RF_FORBIDDEN", `${persona} read`);
    if (read) {
      assert.deepEqual([got.data.canSeeRates, got.data.canWriteRates, got.data.canWriteStandards], [rates, rates, standards], `${persona} flags`);
      assert.equal(got.data.rates.length > 0, rates, `${persona} rates are ${rates ? "listed" : "hidden"}`);
      assert.ok(got.data.standards.length > 0, `${persona} sees the time standards`);
    }
    assert.equal(await error("app_rf_labour_rate_save", { ...okRate, p_rate_per_hour: 70 }), rates ? null : "RF_FORBIDDEN", `${persona} rate save`);
    assert.equal(await error("app_rf_station_standard_save", { ...okStd, p_note: persona }), standards ? null : "RF_FORBIDDEN", `${persona} standard save`);
  }
});

test("BOM unit cost: sent to cost viewers only, and a save by someone who cannot see it keeps the stored value", async () => {
  const { client: sb, bom } = createMockSupabase({ sandbox: true, now: () => NOW });
  const as = async (id) => { assert.equal((await sb.rpc("app_sandbox_enter", { p_persona_id: id })).error, null); };
  bom.edit((current) => {
    current.items.push({ code: "P-A", kind: "PURCHASED", name: "ของซื้อ A", ownerDept: "ST", uom: "pcs", unitCost: 5.5 }, { code: "P-B", kind: "PURCHASED", name: "ของซื้อ B", ownerDept: "ST", uom: "pcs" });
  });
  const itemOf = async (code) => (await sb.rpc("app_bom_master", {})).data.items.find((item) => item.code === code);
  for (const [persona, sees] of [["persona-pp", true], ["persona-fm", true], ["persona-gm", true], ["persona-rb", false], ["persona-rbh", false], ["persona-st", false], ["persona-afm", false], ["persona-wh", false]]) {
    await as(persona);
    const item = await itemOf("P-A");
    assert.equal(item.name, "ของซื้อ A", `${persona} reads the item`);
    assert.equal(item.unitCost, sees ? 5.5 : undefined, `${persona} unit cost`);
  }
  // หัวหน้าแผนก RB เป็นกลุ่มวางแผนของ BOM (แก้ชิ้นงานได้) แต่ไม่เห็นต้นทุน: ส่งค่าใหม่ / ไม่ส่ง = ค่าที่เก็บไว้คงเดิม
  await as("persona-rbh");
  const version = (await sb.rpc("app_bom_master", {})).data.version;
  const edit = await sb.rpc("app_bom_save_master", { p_changes: { items: { upsert: [{ code: "P-A", kind: "PURCHASED", name: "ของซื้อ A2", ownerDept: "ST", uom: "pcs", unitCost: 99 }, { code: "P-B", kind: "PURCHASED", name: "ของซื้อ B2", ownerDept: "ST", uom: "pcs", unitCost: 7 }] } }, p_base_version: version, p_action: "saveItem" });
  assert.equal(edit.error, null);
  assert.equal(edit.data.changes.items.upsert.some((row) => "unitCost" in row), false, "the answer to a non-viewer carries no unit cost");
  await as("persona-pp");
  assert.deepEqual([(await itemOf("P-A")).name, (await itemOf("P-A")).unitCost], ["ของซื้อ A2", 5.5], "the stored cost survived and the value sent was ignored");
  assert.deepEqual([(await itemOf("P-B")).name, (await itemOf("P-B")).unitCost], ["ของซื้อ B2", undefined], "an item without a cost stays without one");
  const next = (await sb.rpc("app_bom_master", {})).data.version;
  assert.equal((await sb.rpc("app_bom_save_master", { p_changes: { items: { upsert: [{ ...(await itemOf("P-A")), unitCost: 6.25 }] } }, p_base_version: next, p_action: "setItemCost" })).error, null);
  assert.equal((await itemOf("P-A")).unitCost, 6.25, "a cost viewer changes the cost");
});
