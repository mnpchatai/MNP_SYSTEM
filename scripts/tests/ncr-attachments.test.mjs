import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function load({ sandbox = false, paths = [], fail = "" } = {}) {
  const log = [];
  const context = vm.createContext({});
  Object.assign(context, {
    window: context, state: { employee: { isSandbox: sandbox } },
    ATTACHMENT_HINT: "เลือกไฟล์", crypto: { randomUUID: () => "uuid-1" },
    escapeHtml: (s) => String(s).replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
    sb: {
      storage: { from: (bucket) => ({
        upload: async (path, file, options) => {
          log.push(["upload", bucket, path, file.name, options.upsert]);
          return { error: fail === "upload" ? new Error("upload failed") : null };
        },
        remove: async (files) => {
          log.push(["remove", bucket, Array.from(files)]);
          if (fail === "throw") throw new Error("network failed");
          return { error: fail === "remove" ? new Error("remove failed") : null };
        },
      }) },
      rpc: async (name, args) => {
        log.push([name, args]);
        if (name === "app_sandbox_begin_ncr_file_cleanup") return { data: paths, error: fail === "begin" ? new Error("not admin") : null };
        if (name === "app_sandbox_purge_ncr") return { data: { deleted: 2 }, error: fail === "purge" ? new Error("NCR_FILES_REMAIN") : null };
        if (name === "app_sandbox_finish_ncr_file_cleanup") return { error: fail === "finish" ? new Error("finish failed") : null };
        return { error: fail === "register" ? new Error("registration failed") : null };
      },
    },
  });
  vm.runInContext(fs.readFileSync("modules/ncr-attachments.js", "utf8"), context);
  return { api: context.MNP_NCR_ATTACHMENTS, log };
}
const ID = "11111111-1111-1111-1111-111111111111";
const file = { name: "หลักฐาน.pdf", type: "application/pdf" };

test("NCR attachment fields allow multiple files in both modes and escape labels", () => {
  for (const sandbox of [false, true]) {
    const { api } = load({ sandbox });
    assert.match(api.fieldHtml("a", "<ภาพ>"), /name="evidence"[^>]*multiple/);
    assert.match(api.fieldHtml("a", "<ภาพ>"), /&lt;ภาพ>/);
  }
});

test("uploads and previews choose the correct bucket without replacing a file", async () => {
  for (const sandbox of [false, true]) {
    const { api, log } = load({ sandbox });
    const expected = sandbox ? "ncr-test-attachments" : "ncr-attachments";
    assert.equal(api.bucket(), expected);
    assert.equal(api.bucket(true), "ncr-test-attachments");
    assert.equal(api.bucket(false), "ncr-attachments");
    await api.uploadOne(ID, file, "report");
    assert.deepEqual(log[0], ["upload", expected, `${ID}/uuid-1-_______.pdf`, file.name, false]);
    assert.equal(log[1][0], "app_ncr_add_attachment");
    assert.equal(log[1][1].p_storage_path, log[0][2]);
    assert.equal(log[1][1].p_file_name, file.name);
    assert.equal(log[1][1].p_section, "report");
  }
});

test("failed uploads never register and failed registrations remove from the same bucket", async () => {
  const down = load({ sandbox: true, fail: "upload" });
  await assert.rejects(() => down.api.uploadOne(ID, file, "response"), /upload failed/);
  assert.equal(down.log.length, 1);
  const bad = load({ sandbox: true, fail: "register" });
  await assert.rejects(() => bad.api.uploadOne(ID, file, "response"), /registration failed/);
  assert.equal(bad.log[2][1], "ncr-test-attachments");
  assert.equal(bad.log[2][2][0], bad.log[0][2]);
});

test("cleanup removes registered and orphan test objects in chunks before purging reports", async () => {
  const paths = Array.from({ length: 205 }, (_, i) => `orphan/f${i}.pdf`);
  const { api, log } = load({ paths });
  assert.equal((await api.purge()).deleted, 2);
  assert.equal(log[0][0], "app_sandbox_begin_ncr_file_cleanup");
  assert.deepEqual(log.filter(([name]) => name === "remove").map(([, , p]) => p.length), [100, 100, 5]);
  assert.ok(log.filter(([name]) => name === "remove").every(([, b]) => b === "ncr-test-attachments"));
  assert.equal(log.at(-2)[0], "app_sandbox_purge_ncr");
  assert.equal(log.at(-1)[0], "app_sandbox_finish_ncr_file_cleanup");
});

test("cleanup failures keep reports and reset temporary permissions, including network errors", async () => {
  for (const fail of ["remove", "throw", "purge"]) {
    const { api, log } = load({ fail, paths: ["a.pdf"] });
    await assert.rejects(() => api.purge(), /failed|NCR_FILES_REMAIN/);
    assert.equal(log.at(-1)[0], "app_sandbox_finish_ncr_file_cleanup");
    if (fail !== "purge") assert.ok(!log.some(([n]) => n === "app_sandbox_purge_ncr"));
  }
  const denied = load({ fail: "begin" });
  await assert.rejects(() => denied.api.purge(), /not admin/);
  assert.equal(denied.log.length, 1);
});

test("an empty bucket is purged and a failure to close cleanup is reported", async () => {
  const empty = load();
  assert.equal((await empty.api.purge()).deleted, 2);
  assert.ok(!empty.log.some(([n]) => n === "remove"));
  const bad = load({ fail: "finish" });
  await assert.rejects(() => bad.api.purge(), /finish failed/);
});
