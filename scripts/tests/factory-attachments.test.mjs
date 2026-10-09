import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { ATTACHMENT_STUBS } from "./support/factory-attachment-stubs.mjs";

// modules/factory-attachments.js (script ธรรมดาใน browser) ใน context จำลอง: เส้นทางไฟล์ การลงทะเบียน การเก็บกวาดเมื่อพลาด
// การไม่ย้อนการกระทำเมื่อไฟล์พลาด การวาดส่วน "ไฟล์แนบ" และการลบไฟล์ทั้งหมดก่อนล้างข้อมูลทดสอบ
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function load({ failUpload = () => false, failRegister = () => false, failRemove = false, listed = [], paths = [] } = {}) {
  const log = { uploads: [], removes: [], rpcs: [], hydrated: [], toasts: [] };
  const context = vm.createContext({});
  const sections = [];
  Object.assign(context, {
    ...ATTACHMENT_STUBS,
    window: context,
    MNP_FACTORY_ERRORS: {},
    crypto: { randomUUID: () => "uuid-1" },
    escapeHtml,
    formatDate: (value) => `d(${value})`,
    showToast: (message, kind) => log.toasts.push([message, kind]),
    friendlyError: (error) => String(error?.message ?? error),
    setFormBusy() {},
    hydrateAttachmentGallery: async (files, bucket) => { log.hydrated.push([files.length, bucket]); },
    document: { querySelectorAll: () => sections },
    sb: {
      storage: {
        from: (bucket) => ({
          upload: async (path, file) => { log.uploads.push([bucket, path, file.name]); return { error: failUpload(file) ? new Error("storage down") : null }; },
          remove: async (list) => { log.removes.push([bucket, list]); return { error: failRemove ? new Error("remove failed") : null }; },
        }),
      },
      rpc: async (name, args) => {
        log.rpcs.push([name, args]);
        if (name === "app_factory_list_attachments") return { data: listed, error: null };
        if (name === "app_factory_attachment_paths") return { data: paths, error: null };
        return { data: "att-1", error: failRegister(args) ? new Error("ATTACHMENT_NOT_UPLOADED") : null };
      },
    },
  });
  vm.runInContext(fs.readFileSync("modules/factory-attachments.js", "utf8"), context, { filename: "modules/factory-attachments.js" });
  return { api: context.MNP_FACTORY_ATTACHMENTS, context, log, sections };
}
const file = (name) => ({ name, size: 10, type: "application/pdf" });
const ID = "11111111-1111-1111-1111-111111111111";

test("the field is the shared extra-files field and the error codes have Thai messages", () => {
  const { api, context } = load();
  assert.match(api.fieldHtml("x-files"), /name="extra_files"[^>]*multiple|multiple[^>]*name="extra_files"/);
  for (const code of ["INVALID_ATTACHMENT", "ATTACHMENT_NOT_UPLOADED", "ATTACHMENT_ENTITY_NOT_FOUND", "FACTORY_FILES_REMAIN"]) assert.ok(context.MNP_FACTORY_ERRORS[code], code);
  assert.deepEqual(JSON.parse(JSON.stringify(api.TYPES)), ["item", "bom", "production_order", "material_order", "job"]);
});

test("no files means no calls; an unknown entity type is refused before anything is uploaded", async () => {
  const { api, log } = load();
  assert.equal(await api.upload("job", ID, []), "");
  assert.equal(await api.upload("job", ID, undefined), "");
  await assert.rejects(() => api.upload("widget", ID, [file("a.pdf")]), /INVALID_ATTACHMENT/);
  assert.deepEqual(log.uploads, []);
  assert.deepEqual(log.rpcs, []);
});

test("files go to <type>/<id>/<uuid>-<safe name> in the private bucket and are registered with the same path", async () => {
  const { api, log } = load();
  assert.equal(await api.upload("production_order", ID, [file("ใบเสนอราคา 01.pdf"), file("b.pdf")]), "");
  assert.equal(log.uploads.length, 2);
  for (const [bucket, path] of log.uploads) {
    assert.equal(bucket, "factory-attachments");
    assert.match(path, new RegExp(`^production_order/${ID}/uuid-1-`));
    assert.doesNotMatch(path, /[^a-zA-Z0-9._/-]/, "the stored name is ascii-safe");
  }
  assert.deepEqual(log.rpcs.map(([name]) => name), ["app_factory_add_attachment", "app_factory_add_attachment"]);
  assert.equal(log.rpcs[0][1].p_entity_type, "production_order");
  assert.equal(log.rpcs[0][1].p_entity_id, ID);
  assert.equal(log.rpcs[0][1].p_storage_path, log.uploads[0][1]);
  assert.equal(log.rpcs[0][1].p_file_name, "ใบเสนอราคา 01.pdf", "the original name is kept for display");
});

test("a failed file is reported without undoing the action, and the other files still go up", async () => {
  const { api, log } = load({ failUpload: (f) => f.name === "bad.pdf" });
  const warning = await api.upload("job", ID, [file("bad.pdf"), file("good.pdf")]);
  assert.match(warning, /แนบไฟล์ไม่สำเร็จ 1 จาก 2 ไฟล์ \(bad\.pdf\)/);
  assert.match(warning, /บันทึกการดำเนินการแล้ว/, "the user is told the action itself was saved");
  assert.equal(log.rpcs.filter(([name]) => name === "app_factory_add_attachment").length, 1, "only the file that reached storage is registered");
});

test("a file that cannot be registered is removed from storage again so nothing is left behind", async () => {
  const { api, log } = load({ failRegister: () => true });
  const warning = await api.upload("bom", ID, [file("a.pdf")]);
  assert.match(warning, /แนบไฟล์ไม่สำเร็จ 1 จาก 1 ไฟล์ \(a\.pdf\)/);
  assert.deepEqual(JSON.parse(JSON.stringify(log.removes)), [["factory-attachments", [log.uploads[0][1]]]]);
});

test("the attachment section is drawn with the document's type and id, escaped", () => {
  const { api } = load();
  const html = api.panelHtml("item", `${ID}"><b>`);
  assert.match(html, /data-fm-attachments="item"/);
  assert.match(html, /data-entity-id="[^"]*&quot;&gt;&lt;b&gt;"/);
  assert.doesNotMatch(html, /<b>/);
});

test("mounting lists each document's files with who attached them and hydrates the previews from the bucket", async () => {
  const listed = [{ id: "f1", file_name: "<spec>.pdf", content_type: "application/pdf", size_bytes: 10, storage_path: "item/x/y", created_at: "2026-10-09T01:00:00Z", uploader_name: "ทดสอบ พนักงาน" }];
  const { api, context, log, sections } = load({ listed });
  const form = { addEventListener() {}, elements: {} };
  const section = { dataset: { fmAttachments: "item", entityId: ID }, innerHTML: "", querySelector: (selector) => (selector === ".fm-attachment-form" ? form : null) };
  sections.push(section);
  await api.mountAll();
  assert.deepEqual(JSON.parse(JSON.stringify(log.rpcs[0])), ["app_factory_list_attachments", { p_entity_type: "item", p_entity_id: ID }]);
  assert.match(section.innerHTML, /<h2>ไฟล์แนบ<\/h2>/);
  assert.match(section.innerHTML, /&lt;spec&gt;\.pdf · ทดสอบ พนักงาน · d\(2026-10-09T01:00:00Z\)/, "the name and uploader are escaped");
  assert.match(section.innerHTML, /name="extra_files"/, "more files can be attached from the section itself");
  assert.deepEqual(JSON.parse(JSON.stringify(log.hydrated)), [[1, "factory-attachments"]]);
  assert.ok(context.MNP_FACTORY_ATTACHMENTS);
});

test("a section that cannot load says so instead of staying on the loading text", async () => {
  const { api, sections, context } = load();
  context.sb.rpc = async () => ({ data: null, error: new Error("denied") });
  const section = { dataset: { fmAttachments: "job", entityId: ID }, innerHTML: "", querySelector: () => null };
  sections.push(section);
  await api.mountAll();
  assert.match(section.innerHTML, /โหลดไฟล์แนบไม่สำเร็จ: denied/);
});

test("clearing the test data removes every stored file in chunks first, and stops if any removal fails", async () => {
  const paths = Array.from({ length: 230 }, (_, index) => `item/${ID}/f${index}`);
  const { api, log } = load({ paths });
  assert.equal(await api.removeAll(), 230);
  assert.deepEqual(log.removes.map(([, list]) => list.length), [100, 100, 30]);
  assert.ok(log.removes.every(([bucket]) => bucket === "factory-attachments"));
  const failing = load({ paths, failRemove: true });
  await assert.rejects(() => failing.api.removeAll(), /remove failed/);
  assert.equal(failing.log.removes.length, 1, "it stops at the first failure");
  const none = load({ paths: [] });
  assert.equal(await none.api.removeAll(), 0);
  assert.deepEqual(none.log.removes, []);
});

test("clearing the test data still works before the attachment migration is applied", async () => {
  const { api, context, log } = load();
  context.sb.rpc = async () => ({ data: null, error: { code: "PGRST202", message: "function not found" } });
  assert.equal(await api.removeAll(), 0);
  context.sb.rpc = async () => ({ data: null, error: { code: "42501", message: "denied" } });
  await assert.rejects(() => api.removeAll(), (error) => error.code === "42501", "any other error still stops the clear");
  assert.deepEqual(log.removes, []);
});
