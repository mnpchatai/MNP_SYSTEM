import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function setup(respond) {
  const elements = new Map();
  const events = {};
  const calls = [];
  let authChange;
  let denied = 0;
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      value: selector === "#lab-sort" ? "recent" : "", textContent: "", innerHTML: "", hidden: false,
      addEventListener() {}, setAttribute() {}, classList: { toggle() {} },
    });
    return elements.get(selector);
  };
  const window = { addEventListener: (name, fn) => { events[name] = fn; }, setInterval: () => 1, clearInterval() {}, clearTimeout() {} };
  const context = vm.createContext({ window, console, URLSearchParams, Map, Set, Date, Intl, location: { hash: "#/lab" },
    document: { hidden: false, addEventListener() {}, querySelector: element },
    state: { employee: { id: "admin", labAccess: true } }, app: { innerHTML: "" },
    sb: { auth: { onAuthStateChange: (fn) => { authChange = fn; } }, rpc: async (name, args) => {
      calls.push({ name, args }); return respond(name, args);
    } },
    shell: (html) => html, bindShell() {}, loadingShell() {}, renderNotFound() { denied += 1; },
  });
  for (const file of ["lab-mooney-model.js", "lab-mooney-chart.js", "lab-mooney-views.js", "module-lab.js"]) {
    vm.runInContext(readFileSync(new URL(`../../modules/${file}`, import.meta.url), "utf8"), context);
  }
  return { context, calls, element, events, auth: (event) => authChange(event), denied: () => denied,
    open: () => window.MNP_REQUEST_MODULES.MNP_LAB.pages.lab(new URLSearchParams()) };
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
