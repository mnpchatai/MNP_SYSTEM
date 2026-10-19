import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function setup(respond) {
  const elements = new Map();
  const events = {};
  const listeners = new Map();
  const timers = [];
  const toasts = [];
  const calls = [];
  let authChange;
  let denied = 0;
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      // ฟอร์มข้อมูลยางเส้นปิดอยู่ในหน้าตั้งต้น (มี hidden ใน HTML) ที่เหลือเริ่มที่ไม่ซ่อน
      value: selector === "#lab-sort" ? "recent" : "", textContent: "", innerHTML: "", hidden: selector === "#lab-strand-form",
      addEventListener: (name, fn) => { listeners.set(`${selector}|${name}`, fn); }, setAttribute() {}, classList: { toggle() {} },
    });
    return elements.get(selector);
  };
  const window = { addEventListener: (name, fn) => { events[name] = fn; }, setInterval: () => 1, clearInterval() {}, setTimeout: (fn) => timers.push(fn), clearTimeout() {}, cancelAnimationFrame() {} };
  const context = vm.createContext({ window, console, URLSearchParams, Map, Set, Date, Intl, location: { hash: "#/lab" },
    document: { hidden: false, addEventListener() {}, querySelector: element },
    state: { employee: { id: "admin", labAccess: true } }, app: { innerHTML: "" },
    sb: { auth: { onAuthStateChange: (fn) => { authChange = fn; } }, rpc: async (name, args) => {
      calls.push({ name, args }); return respond(name, args);
    } },
    shell: (html) => html, bindShell() {}, loadingShell() {}, renderNotFound() { denied += 1; },
    // helper ของ app.js ที่ฟอร์มข้อมูลยางเส้นเรียกตอนผู้ใช้กด: friendlyError เลียนแบบการหาข้อความจาก errorMessages ของโมดูล
    // เหมือน setFormBusy ของ app.js: ปิด/เปิดทุกปุ่มและช่องของฟอร์ม (รวมช่อง ID ที่ล็อกไว้ตอนแก้ไข ซึ่งโค้ดหน้าต้องล็อกกลับเอง)
    setFormBusy(form, busy) {
      for (const id of ["id", "order", "outer", "outer-min", "outer-max", "inner", "inner-min", "inner-max", "save", "cancel", "delete"]) element(`#lab-strand-${id}`).disabled = busy;
    },
    showToast: (message) => { toasts.push(message); },
    friendlyError(error) {
      const message = String(error?.message ?? error);
      const map = window.MNP_REQUEST_MODULES.MNP_LAB.errorMessages;
      const key = Object.keys(map).find((item) => message.includes(item));
      return key ? map[key] : message;
    },
  });
  for (const file of ["lab-mooney-model.js", "lab-mooney-chart.js", "lab-mooney-views.js", "lab-strand-model.js", "lab-strand-views.js", "module-lab.js"]) {
    vm.runInContext(readFileSync(new URL(`../../modules/${file}`, import.meta.url), "utf8"), context);
  }
  return { context, calls, element, events, timers, toasts, auth: (event) => authChange(event), denied: () => denied,
    fire: (selector, name, event = {}) => listeners.get(`${selector}|${name}`)({ preventDefault() {}, ...event }),
    open: (params = "") => window.MNP_REQUEST_MODULES.MNP_LAB.pages.lab(new URLSearchParams(params)) };
}
const body = (materials = []) => ({ generated_at: new Date().toISOString(), materials, rows: [] });
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("overview uses one scoped RPC and paints precomputed summaries without raw rows", async () => {
  const app = setup(async () => ({ data: body([{ material: "A", resultCount: 12000, lastTested: "2026-10-01" }]), error: null }));
  await app.open();
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls)), [{ name: "app_lab_mooney_feed", args: { p_material: null } }]);
  assert.match(app.element("#lab-materials").innerHTML, /A/);
  assert.match(app.element("#lab-materials").innerHTML, /12,000/);
  assert.match(app.element("#lab-updated").textContent, /ข้อมูลชีต/);
});

test("cached navigation paints before slow revalidation, then removes access when revoked", async () => {
  let resolve;
  let count = 0;
  const app = setup(async () => ++count === 1 ? { data: body([{ material: "A", resultCount: 1 }]), error: null }
    : await new Promise((done) => { resolve = done; }));
  await app.open();
  app.context.app.innerHTML = "reset";
  await app.open();
  assert.notEqual(app.context.app.innerHTML, "reset", "cached screen paints without waiting for RPC");
  assert.equal(app.calls.length, 2, "server permissions still rechecked");
  resolve({ error: { message: "NOT_AUTHORIZED" } });
  await flush();
  assert.equal(app.denied(), 1);
  assert.equal(app.context.state.employee.labAccess, false);
});

test("sign out clears caches and an old in-flight page cannot repaint another account", async () => {
  let resolve;
  const app = setup(() => new Promise((done) => { resolve = done; }));
  const pending = app.open();
  app.auth("SIGNED_OUT");
  app.context.state.employee = { id: "other", labAccess: false };
  app.context.app.innerHTML = "other account";
  resolve({ data: body(), error: null });
  await pending;
  assert.equal(app.context.app.innerHTML, "other account");
  assert.equal(app.denied(), 0, "old response cannot revoke the new account");
});

test("leaving LAB cancels stale initial renders; no permission means no RPC", async () => {
  let resolve;
  const app = setup(() => new Promise((done) => { resolve = done; }));
  const pending = app.open();
  app.context.location.hash = "#/requests";
  app.events.hashchange();
  app.context.app.innerHTML = "requests";
  resolve({ data: body(), error: null });
  await pending;
  assert.equal(app.context.app.innerHTML, "requests");
  const denied = setup(() => { throw new Error("must not query"); });
  denied.context.state.employee.labAccess = false;
  await denied.open();
  assert.equal(denied.calls.length, 0);
});

test("material navigation scopes its RPC and keeps the full material selector on an empty result", async () => {
  const app = setup(async () => ({ data: body([{ material: "A", resultCount: 2 }, { material: "B", resultCount: 3 }]), error: null }));
  await app.open("material=A");
  assert.equal(app.calls[0].args.p_material, "A");
  assert.match(app.element("#lab-material-select").innerHTML, /value="A" selected/);
  assert.match(app.element("#lab-material-select").innerHTML, /value="B"/);
  assert.equal(app.element("#lab-none").hidden, false);
  assert.equal(app.element("#lab-body").hidden, true);
});

test("stale data retains its original date and gives a freshness warning", async () => {
  const data = { ...body(), generated_at: "2026-01-01T01:02:03Z" };
  const app = setup(async () => ({ data, error: null }));
  await app.open();
  assert.match(app.element("#lab-updated").textContent, /01\/01\/2026/);
  assert.match(app.element("#lab-status").textContent, /ยังไม่อัปเดต/);
});

/* ---------- ข้อมูลยางเส้น (ออเดอร์ ขนาดวงนอก/รูใน สเปก) ---------- */

const labRow = (id) => ({ source_sheet: "A", sample_id: id, material: "A", test_date: "2026-10-01", test_time: "09:00:00", temperature_c: 100, test_minutes: 4, mh: 50, mv: 30, avg_mh: null, sd_mh: null, avg_mv: null, sd_mv: null });
const specRow = (id, overrides = {}) => ({ sample_id: id, order_no: "PO-1", outer_mm: 20.1, inner_mm: 3, outer_min_mm: 19.5, outer_max_mm: 20.5, inner_min_mm: 2.5, inner_max_mm: 3.5, version: 1, updated_at: "2026-10-19T00:00:00Z", ...overrides });
const materialFeed = () => ({ ...body([{ material: "A", resultCount: 3 }]), rows: ["111", "112", "113"].map(labRow) });

// ตอบ RPC ตามชื่อ: ฟีด, รายการข้อมูลยางเส้น (specs เป็นอาร์เรย์หรือ error), และการบันทึก/ลบ (ตอบตามที่ส่งมา)
function strandApp({ specs = [], specsError = null, save, remove } = {}) {
  const app = setup(async (name, args) => {
    if (name === "app_lab_mooney_feed") return { data: materialFeed(), error: null };
    if (name === "app_lab_strand_specs") return specsError ? { data: null, error: specsError } : { data: specs, error: null };
    if (name === "app_lab_strand_spec_save") return save ? save(args) : { data: specRow(args.p_sample_id, { version: (args.p_expected_version ?? 0) + 1 }), error: null };
    if (name === "app_lab_strand_spec_delete") return remove ? remove(args) : { data: { deleted: true }, error: null };
    throw new Error(`unexpected rpc ${name}`);
  });
  return app;
}
const fill = (app, values) => {
  const map = { id: "#lab-strand-id", order: "#lab-strand-order", outer: "#lab-strand-outer", outerMin: "#lab-strand-outer-min", outerMax: "#lab-strand-outer-max", inner: "#lab-strand-inner", innerMin: "#lab-strand-inner-min", innerMax: "#lab-strand-inner-max" };
  for (const [key, value] of Object.entries(values)) app.element(map[key]).value = value;
};
const plain = (value) => JSON.parse(JSON.stringify(value));

test("a material page reads the strand data of that material after the feed, and the overview never asks for it", async () => {
  const material = strandApp({ specs: [specRow("112", { order_no: "PO-9" })] });
  await material.open("material=A");
  assert.deepEqual(plain(material.calls.map((call) => call.name)), ["app_lab_mooney_feed", "app_lab_strand_specs"]);
  assert.equal(material.calls[1].args.p_material, "A");
  assert.equal(material.element("#lab-strand-card").hidden, false);
  assert.match(material.element("#lab-strand-scroll").innerHTML, /PO-9/);
  assert.equal(material.element("#lab-strand-empty").hidden, true);

  const overview = strandApp();
  await overview.open();
  assert.deepEqual(plain(overview.calls.map((call) => call.name)), ["app_lab_mooney_feed"], "no strand RPC from the overview");
});

test("a database without the strand RPCs keeps the page working and hides the card", async () => {
  const app = strandApp({ specsError: { code: "PGRST202", message: "Could not find the function public.app_lab_strand_specs(p_material) in the schema cache" } });
  await app.open("material=A");
  assert.equal(app.element("#lab-strand-card").hidden, true);
  assert.equal(app.element("#lab-body").hidden, false, "the Mooney results still show");
  assert.equal(app.denied(), 0);
});

test("a temporary strand read failure keeps the page, tells the user, and blocks adding", async () => {
  const app = strandApp({ specsError: { code: "XX000", message: "boom" } });
  await app.open("material=A");
  assert.equal(app.element("#lab-strand-card").hidden, false);
  assert.match(app.element("#lab-strand-note").textContent, /ไม่สำเร็จ/);
  assert.equal(app.element("#lab-strand-note").hidden, false);
  assert.equal(app.element("#lab-strand-add").disabled, true);
  assert.equal(app.denied(), 0);
});

test("a permission error on the strand read removes access like the main feed", async () => {
  const app = strandApp({ specsError: { message: "NOT_AUTHORIZED" } });
  await app.open("material=A");
  assert.equal(app.denied(), 1);
  assert.equal(app.context.state.employee.labAccess, false);
});

test("adding strand data offers only IDs without data, validates first, then saves with a null version", async () => {
  const app = strandApp({ specs: [specRow("112")] });
  await app.open("material=A");
  app.fire("#lab-strand-add", "click");
  assert.equal(app.element("#lab-strand-form").hidden, false);
  assert.match(app.element("#lab-strand-form-title").textContent, /เพิ่มข้อมูลยางเส้น/);
  const options = app.element("#lab-strand-id").innerHTML;
  assert.match(options, /value="111"/);
  assert.match(options, /value="113"/);
  assert.doesNotMatch(options, /value="112"/, "an ID that already has data cannot be added again");
  assert.equal(app.element("#lab-strand-delete").hidden, true);

  const before = app.calls.length;
  fill(app, { id: "111", order: "", outer: "", outerMin: "", outerMax: "", inner: "", innerMin: "", innerMax: "" });
  await app.fire("#lab-strand-form", "submit");
  assert.match(app.element("#lab-strand-error").textContent, /อย่างน้อยหนึ่งช่อง/);
  assert.equal(app.calls.length, before, "an invalid form never reaches the database");

  fill(app, { id: "111", order: " PO-2610-001 ", outer: "20,10", outerMin: "19.5", outerMax: "20.5", inner: "", innerMin: "", innerMax: "" });
  await app.fire("#lab-strand-form", "submit");
  const save = app.calls.at(-1);
  assert.equal(save.name, "app_lab_strand_spec_save");
  assert.deepEqual(plain(save.args), {
    p_material: "A", p_sample_id: "111", p_order_no: "PO-2610-001", p_outer_mm: 20.1, p_inner_mm: null,
    p_outer_min_mm: 19.5, p_outer_max_mm: 20.5, p_inner_min_mm: null, p_inner_max_mm: null, p_expected_version: null,
  });
  assert.equal(app.element("#lab-strand-form").hidden, true, "the form closes after saving");
  assert.deepEqual(plain(app.toasts), ["บันทึกแล้ว"]);
  assert.match(app.element("#lab-strand-scroll").innerHTML, /data-strand-edit="111"/, "the saved ID is listed");
  assert.match(app.element("#lab-strand-scroll").innerHTML, /data-strand-edit="112"/);
});

test("editing sends the version that was seen and locks the ID", async () => {
  const app = strandApp({ specs: [specRow("112", { version: 3 })] });
  await app.open("material=A");
  app.fire("#lab-strand-scroll", "click", { target: { closest: () => ({ dataset: { strandEdit: "112" } }) } });
  assert.equal(app.element("#lab-strand-form").hidden, false);
  assert.equal(app.element("#lab-strand-form-title").textContent, "แก้ไขข้อมูล", "the locked ID field says which ID, the title does not repeat it");
  assert.equal(app.element("#lab-strand-id").disabled, true);
  assert.match(app.element("#lab-strand-id").innerHTML, /value="112" selected/);
  assert.equal(app.element("#lab-strand-order").value, "PO-1");
  assert.equal(app.element("#lab-strand-outer").value, "20.1");
  assert.equal(app.element("#lab-strand-delete").hidden, false);
  fill(app, { order: "PO-2" });
  await app.fire("#lab-strand-form", "submit");
  const save = app.calls.at(-1);
  assert.equal(save.args.p_sample_id, "112", "the ID comes from the record, not the locked field");
  assert.equal(save.args.p_expected_version, 3);
  assert.equal(save.args.p_order_no, "PO-2");
});

test("a conflict closes the form, explains why, and reloads the latest data", async () => {
  const app = strandApp({
    specs: [specRow("112", { version: 3 })],
    save: () => ({ data: null, error: { message: "LAB_SPEC_CONFLICT" } }),
  });
  await app.open("material=A");
  app.fire("#lab-strand-scroll", "click", { target: { closest: () => ({ dataset: { strandEdit: "112" } }) } });
  const before = app.calls.length;
  await app.fire("#lab-strand-form", "submit");
  await flush();
  assert.equal(app.element("#lab-strand-form").hidden, true);
  assert.match(app.element("#lab-strand-note").textContent, /ผู้อื่น/);
  assert.ok(app.calls.slice(before).some((call) => call.name === "app_lab_strand_specs"), "the latest list is reloaded");
  assert.deepEqual(plain(app.toasts), [], "no success toast on a conflict");
});

test("another failure keeps the form open with the message so nothing typed is lost", async () => {
  const app = strandApp({ save: () => ({ data: null, error: { message: "LAB_SAMPLE_NOT_FOUND" } }) });
  await app.open("material=A");
  app.fire("#lab-strand-add", "click");
  fill(app, { id: "111", order: "PO-5" });
  await app.fire("#lab-strand-form", "submit");
  assert.equal(app.element("#lab-strand-form").hidden, false);
  assert.match(app.element("#lab-strand-error").textContent, /ไม่พบ ID/);
  assert.equal(app.element("#lab-strand-order").value, "PO-5");
});

test("losing permission while saving removes access instead of showing a form error", async () => {
  const app = strandApp({ save: () => ({ data: null, error: { message: "NOT_AUTHORIZED" } }) });
  await app.open("material=A");
  app.fire("#lab-strand-add", "click");
  fill(app, { id: "111", order: "PO-5" });
  await app.fire("#lab-strand-form", "submit");
  assert.equal(app.denied(), 1);
  assert.equal(app.context.state.employee.labAccess, false);
});

test("delete needs two presses, then sends the seen version and drops the record", async () => {
  const app = strandApp({ specs: [specRow("112", { version: 4 })] });
  await app.open("material=A");
  app.fire("#lab-strand-scroll", "click", { target: { closest: () => ({ dataset: { strandEdit: "112" } }) } });
  app.fire("#lab-strand-delete", "click");
  assert.match(app.element("#lab-strand-delete").textContent, /อีกครั้ง/);
  assert.equal(app.calls.at(-1).name, "app_lab_strand_specs", "the first press only arms the button");
  app.timers.at(-1)();
  assert.equal(app.element("#lab-strand-delete").textContent, "ลบข้อมูล", "the armed state expires on its own");
  app.fire("#lab-strand-delete", "click");
  app.fire("#lab-strand-delete", "click");
  await flush();
  const removal = app.calls.at(-1);
  assert.equal(removal.name, "app_lab_strand_spec_delete");
  assert.deepEqual(plain(removal.args), { p_material: "A", p_sample_id: "112", p_expected_version: 4 });
  assert.equal(app.element("#lab-strand-form").hidden, true);
  assert.doesNotMatch(app.element("#lab-strand-scroll").innerHTML, /112/);
  assert.deepEqual(plain(app.toasts), ["ลบแล้ว"]);
  assert.equal(app.element("#lab-strand-empty").hidden, false, "an empty material says there is no data yet");
});

test("choosing an ID filters the strand table, and adding preselects that ID", async () => {
  const app = strandApp({ specs: [specRow("111"), specRow("112")] });
  await app.open("material=A");
  assert.match(app.element("#lab-strand-scroll").innerHTML, /data-strand-edit="111"/);
  app.element("#lab-id-select").value = "112";
  app.fire("#lab-id-select", "change");
  const table = app.element("#lab-strand-scroll").innerHTML;
  assert.doesNotMatch(table, /data-strand-edit="111"/);
  assert.match(table, /data-strand-edit="112"/);
  app.element("#lab-id-select").value = "113";
  app.fire("#lab-id-select", "change");
  assert.equal(app.element("#lab-strand-scroll").hidden, true);
  assert.equal(app.element("#lab-strand-empty").textContent, "ID นี้ยังไม่มีข้อมูลออเดอร์และขนาด", "the header selector already names the ID");
  app.fire("#lab-strand-add", "click");
  assert.equal(app.element("#lab-strand-id").value, "113", "the ID being viewed is preselected");
});

test("when every ID already has data, adding says so instead of opening an empty form", async () => {
  const app = strandApp({ specs: ["111", "112", "113"].map((id) => specRow(id)) });
  await app.open("material=A");
  app.fire("#lab-strand-add", "click");
  assert.equal(app.element("#lab-strand-form").hidden, true, "no form is opened");
  assert.equal(app.element("#lab-strand-form-title").textContent, "");
  assert.match(app.element("#lab-strand-note").textContent, /ทุก ID/);
});

/* ---------- ข้อมูลยางเส้น: ซ้อนกับรอบรีเฟรช ความล้มเหลวชั่วคราว แคช และการลองใหม่ ---------- */

// ตอบ RPC ด้วยฟังก์ชันของเทสต์: feed เสมอสำเร็จ, onStrands(n, args) ตอบการอ่านรายการครั้งที่ n (เริ่มที่ 1), save/remove ตามเดิม
function scriptedApp({ onStrands, save, remove }) {
  let reads = 0;
  return setup(async (name, args) => {
    if (name === "app_lab_mooney_feed") return { data: materialFeed(), error: null };
    if (name === "app_lab_strand_specs") return onStrands(++reads, args);
    if (name === "app_lab_strand_spec_save") return save ? save(args) : { data: specRow(args.p_sample_id, { version: (args.p_expected_version ?? 0) + 1 }), error: null };
    if (name === "app_lab_strand_spec_delete") return remove ? remove(args) : { data: { deleted: true }, error: null };
    throw new Error(`unexpected rpc ${name}`);
  });
}
const never = () => new Promise(() => {});

test("a poll that read the list before a save and answers after it cannot undo the save", async () => {
  let release;
  const app = scriptedApp({ onStrands: (n) => (n === 2 ? new Promise((done) => { release = done; }) : { data: [], error: null }) });
  await app.open("material=A");
  app.fire("#lab-refresh", "click");
  await flush();
  assert.equal(typeof release, "function", "the poll's read is in flight");
  app.fire("#lab-strand-add", "click");
  fill(app, { id: "111", order: "PO-1" });
  await app.fire("#lab-strand-form", "submit");
  assert.match(app.element("#lab-strand-scroll").innerHTML, /data-strand-edit="111"/);
  release({ data: [], error: null });
  await flush();
  assert.match(app.element("#lab-strand-scroll").innerHTML, /data-strand-edit="111"/, "the stale answer did not remove the saved record");
  app.fire("#lab-strand-add", "click");
  assert.doesNotMatch(app.element("#lab-strand-id").innerHTML, /value="111"/, "and the ID is not offered for adding again");
});

test("a poll that read the list before a delete cannot bring the record back", async () => {
  let release;
  const app = scriptedApp({ onStrands: (n) => (n === 2 ? new Promise((done) => { release = done; }) : { data: [specRow("112", { version: 2 })], error: null }) });
  await app.open("material=A");
  app.fire("#lab-refresh", "click");
  await flush();
  app.fire("#lab-strand-scroll", "click", { target: { closest: () => ({ dataset: { strandEdit: "112" } }) } });
  app.fire("#lab-strand-delete", "click");
  app.fire("#lab-strand-delete", "click");
  await flush();
  assert.doesNotMatch(app.element("#lab-strand-scroll").innerHTML, /112/);
  release({ data: [specRow("112", { version: 2 })], error: null });
  await flush();
  assert.doesNotMatch(app.element("#lab-strand-scroll").innerHTML, /data-strand-edit="112"/, "the deleted record stays deleted");
});

test("a failed poll keeps the list that is on screen, says so, and recovers on the next good read", async () => {
  let failing = false;
  const app = scriptedApp({ onStrands: () => (failing ? { data: null, error: { code: "XX000", message: "boom" } } : { data: [specRow("112")], error: null }) });
  await app.open("material=A");
  assert.match(app.element("#lab-strand-scroll").innerHTML, /data-strand-edit="112"/);
  failing = true;
  app.fire("#lab-refresh", "click");
  await flush();
  assert.match(app.element("#lab-strand-scroll").innerHTML, /data-strand-edit="112"/, "the known list is not wiped");
  assert.equal(app.element("#lab-strand-scroll").hidden, false);
  assert.match(app.element("#lab-strand-note").textContent, /ไม่สำเร็จ/);
  assert.equal(app.element("#lab-strand-add").disabled, true);
  failing = false;
  app.fire("#lab-refresh", "click");
  await flush();
  assert.equal(app.element("#lab-strand-add").disabled, false);
  assert.equal(app.element("#lab-strand-note").hidden, true);
});

test("after a conflict the latest list is read even though a poll is already in flight", async () => {
  const app = scriptedApp({
    onStrands: (n) => (n === 1 ? { data: [specRow("112", { version: 3 })], error: null }
      : n === 2 ? never()
        : { data: [specRow("112", { version: 5, order_no: "THEIRS" })], error: null }),
    save: () => ({ data: null, error: { message: "LAB_SPEC_CONFLICT" } }),
  });
  await app.open("material=A");
  app.fire("#lab-refresh", "click");
  await flush();
  app.fire("#lab-strand-scroll", "click", { target: { closest: () => ({ dataset: { strandEdit: "112" } }) } });
  await app.fire("#lab-strand-form", "submit");
  await flush();
  assert.match(app.element("#lab-strand-scroll").innerHTML, /THEIRS/, "the other person's version is on screen");
  assert.match(app.element("#lab-strand-note").textContent, /ผู้อื่น/);
  assert.doesNotMatch(app.element("#lab-strand-note").textContent, /กำลังโหลด/, "the notice does not promise a load that may never happen");
});

test("reopening a material from the page cache shows what was just saved before the recheck answers", async () => {
  const app = scriptedApp({ onStrands: (n) => (n === 1 ? { data: [], error: null } : never()) });
  await app.open("material=A");
  app.fire("#lab-strand-add", "click");
  fill(app, { id: "111", order: "PO-1" });
  await app.fire("#lab-strand-form", "submit");
  app.element("#lab-strand-scroll").innerHTML = "";
  await app.open("material=A");
  assert.match(app.element("#lab-strand-scroll").innerHTML, /data-strand-edit="111"/);
});

test("a database without the RPC is probed once per page open, not on every poll", async () => {
  const missing = { code: "PGRST202", message: "Could not find the function public.app_lab_strand_specs" };
  const app = scriptedApp({ onStrands: () => ({ data: null, error: missing }) });
  const strandCalls = () => app.calls.filter((call) => call.name === "app_lab_strand_specs").length;
  await app.open("material=A");
  assert.equal(strandCalls(), 1);
  app.fire("#lab-refresh", "click");
  await flush();
  app.fire("#lab-refresh", "click");
  await flush();
  assert.equal(strandCalls(), 1, "polls do not repeat a call that cannot succeed");
  await app.open("material=A");
  await flush();
  assert.equal(strandCalls(), 2, "opening the page again checks once more, so an applied migration is picked up");
});

test("a failed save keeps the form open with the ID still locked and returns focus to where the user was", async () => {
  const app = strandApp({ specs: [specRow("112")], save: () => ({ data: null, error: { message: "LAB_INVALID_SIZE" } }) });
  await app.open("material=A");
  app.fire("#lab-strand-scroll", "click", { target: { closest: () => ({ dataset: { strandEdit: "112" } }) } });
  let refocused = 0;
  app.context.document.activeElement = { focus() { refocused += 1; } };
  fill(app, { outer: "20" });
  await app.fire("#lab-strand-form", "submit");
  assert.equal(app.element("#lab-strand-form").hidden, false);
  assert.equal(app.element("#lab-strand-id").disabled, true, "setFormBusy re-enabled every field; the page locks the ID again");
  assert.equal(app.element("#lab-strand-order").disabled, false);
  assert.match(app.element("#lab-strand-error").textContent, /ทศนิยมไม่เกิน 2/);
  assert.equal(refocused, 1);
});
