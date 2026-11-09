import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

// pilot-auth อนุมัติคำร้องบัญชี: ผู้เรียกต้องผ่านการตรวจสิทธิ์ในนามผู้ใช้ก่อนเขียน Supabase Auth ด้วย service role
const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../../supabase/functions/pilot-auth/approve.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(output, { exports, Array, String, Promise });
const { approveAccountRequest, authErrorStatus } = exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const REQ = "11111111-1111-4111-8111-111111111111";
const EMP = "22222222-2222-4222-8222-222222222222";
const AUTH = "33333333-3333-4333-8333-333333333333";

const credentialRequest = { id: REQ, kind: "credential_change", status: "pending", employee_id: EMP, employee_no: "THTWGOT", email: null, desired_password: "chosen-by-requester" };
const newAccountRequest = { id: REQ, kind: "new_account", status: "pending", employee_id: null, employee_no: "E1001", email: "", desired_password: "new-pass-123" };

// ฐานข้อมูลจำลอง: rpc คือคำตอบของ RPC ในนามผู้ใช้ calls เก็บทุกการเรียกตามลำดับ
function harness({ request, rpc }) {
  const calls = [];
  const deps = {
    rpcAsUser: async (fn, args) => {
      calls.push(["rpc", fn, plain(args)]);
      const answer = rpc[fn];
      if (!answer) throw new Error(`unexpected rpc ${fn}`);
      return typeof answer === "function" ? answer(args) : answer;
    },
    readRequest: async (id) => {
      calls.push(["readRequest", id]);
      return request;
    },
    createAuthUser: async (input) => {
      calls.push(["createAuthUser", plain(input)]);
      return { userId: "new-auth-user", error: null };
    },
    updateAuthPassword: async (authUserId, password) => {
      calls.push(["updateAuthPassword", authUserId, password]);
      return null;
    },
    deleteAuthUser: async (authUserId) => {
      calls.push(["deleteAuthUser", authUserId]);
    },
  };
  return { deps, calls };
}

const authWrites = (calls) => calls.filter(([kind]) => ["createAuthUser", "updateAuthPassword", "deleteAuthUser"].includes(kind));
const notAdmin = { data: [], error: null };
const adminSees = { data: [{ id: REQ, status: "pending" }], error: null };

test("a caller without accounts.manage cannot change a pending request's password", async () => {
  const { deps, calls } = harness({ request: credentialRequest, rpc: { app_list_account_requests: notAdmin } });
  const result = plain(await approveAccountRequest(deps, REQ, null));
  assert.deepEqual(result, { status: 403, body: { error: "NOT_AUTHORIZED" } });
  assert.deepEqual(authWrites(calls), []);
  assert.deepEqual(calls[0], ["rpc", "app_list_account_requests", { p_status: "pending" }], "authorization is the first call");
});

test("the request id is matched regardless of letter case", async () => {
  const { deps } = harness({
    request: newAccountRequest,
    rpc: { app_list_account_requests: adminSees, app_apply_account_request: { data: EMP, error: null } },
  });
  assert.equal((await approveAccountRequest(deps, REQ.toUpperCase(), null)).status, 200);
});

test("a caller without accounts.manage cannot create an Auth user for a new-account request", async () => {
  const { deps, calls } = harness({ request: newAccountRequest, rpc: { app_list_account_requests: notAdmin } });
  const result = plain(await approveAccountRequest(deps, REQ, null));
  assert.deepEqual(result, { status: 403, body: { error: "NOT_AUTHORIZED" } });
  assert.deepEqual(authWrites(calls), []);
});

test("an RPC error from the authorization check stops before any Auth write", async () => {
  const { deps, calls } = harness({ request: credentialRequest, rpc: { app_list_account_requests: { data: null, error: "AUTH_REQUIRED" } } });
  const result = plain(await approveAccountRequest(deps, REQ, null));
  assert.deepEqual(result, { status: 401, body: { error: "AUTH_REQUIRED" } });
  assert.deepEqual(calls.map(([kind]) => kind), ["rpc"]);
});

test("another admin cannot push through the master's pending password change", async () => {
  const { deps, calls } = harness({
    request: credentialRequest,
    rpc: { app_list_account_requests: adminSees, app_admin_target_auth_user: { data: null, error: "MASTER_PROTECTED" } },
  });
  const result = plain(await approveAccountRequest(deps, REQ, null));
  assert.deepEqual(result, { status: 403, body: { error: "MASTER_PROTECTED" } });
  assert.deepEqual(authWrites(calls), []);
  assert.deepEqual(calls.find(([, fn]) => fn === "app_admin_target_auth_user")[2], { p_employee_id: EMP });
});

test("an admin approves a credential change: target checked as the user, then the password, then apply", async () => {
  const { deps, calls } = harness({
    request: credentialRequest,
    rpc: {
      app_list_account_requests: adminSees,
      app_admin_target_auth_user: { data: AUTH, error: null },
      app_apply_account_request: { data: EMP, error: null },
    },
  });
  const result = plain(await approveAccountRequest(deps, REQ, "role-1"));
  assert.deepEqual(result, { status: 200, body: { employeeId: EMP } });
  assert.deepEqual(calls.map((call) => call[0] === "rpc" ? call[1] : call[0]), [
    "app_list_account_requests",
    "readRequest",
    "app_admin_target_auth_user",
    "updateAuthPassword",
    "app_apply_account_request",
  ]);
  assert.deepEqual(calls[3], ["updateAuthPassword", AUTH, "chosen-by-requester"]);
  assert.deepEqual(calls[4][2], { p_request_id: REQ, p_auth_user_id: null, p_role_id: "role-1" });
});

test("a credential change whose employee has no login account returns EMPLOYEE_NOT_FOUND 404", async () => {
  const { deps, calls } = harness({
    request: credentialRequest,
    rpc: { app_list_account_requests: adminSees, app_admin_target_auth_user: { data: null, error: "EMPLOYEE_NOT_FOUND" } },
  });
  const result = plain(await approveAccountRequest(deps, REQ, null));
  assert.deepEqual(result, { status: 404, body: { error: "EMPLOYEE_NOT_FOUND" } });
  assert.deepEqual(authWrites(calls), []);
});

test("an admin approves a new account; a failed apply removes the Auth user it created", async () => {
  const ok = harness({
    request: newAccountRequest,
    rpc: { app_list_account_requests: adminSees, app_apply_account_request: { data: EMP, error: null } },
  });
  assert.deepEqual(plain(await approveAccountRequest(ok.deps, REQ, null)), { status: 200, body: { employeeId: EMP } });
  assert.deepEqual(ok.calls.find(([kind]) => kind === "createAuthUser")[1], { email: "e1001@pilot.mnp.local", password: "new-pass-123", employeeNo: "E1001" });

  const failed = harness({
    request: newAccountRequest,
    rpc: { app_list_account_requests: adminSees, app_apply_account_request: { data: null, error: "NOT_AUTHORIZED" } },
  });
  assert.deepEqual(plain(await approveAccountRequest(failed.deps, REQ, null)), { status: 403, body: { error: "NOT_AUTHORIZED" } });
  assert.deepEqual(failed.calls.at(-1), ["deleteAuthUser", "new-auth-user"]);
});

test("requests that are no longer pending or have no password keep their error codes", async () => {
  const approved = harness({ request: { ...credentialRequest, status: "approved" }, rpc: { app_list_account_requests: adminSees } });
  assert.deepEqual(plain(await approveAccountRequest(approved.deps, REQ, null)), { status: 409, body: { error: "REQUEST_NOT_PENDING" } });

  const missing = harness({ request: null, rpc: { app_list_account_requests: notAdmin } });
  assert.deepEqual(plain(await approveAccountRequest(missing.deps, REQ, null)), { status: 409, body: { error: "REQUEST_NOT_PENDING" } });

  const noPassword = harness({ request: { ...credentialRequest, desired_password: null }, rpc: { app_list_account_requests: adminSees } });
  assert.deepEqual(plain(await approveAccountRequest(noPassword.deps, REQ, null)), { status: 409, body: { error: "PASSWORD_MISSING" } });
  assert.deepEqual(authWrites(noPassword.calls), []);
});

test("RPC error messages map to HTTP status", () => {
  assert.equal(authErrorStatus("AUTH_REQUIRED"), 401);
  assert.equal(authErrorStatus("NOT_AUTHORIZED"), 403);
  assert.equal(authErrorStatus("MASTER_PROTECTED"), 403);
  assert.equal(authErrorStatus("EMPLOYEE_NOT_FOUND"), 400);
  assert.equal(authErrorStatus("EMPLOYEE_NOT_FOUND", 404), 404);
});
