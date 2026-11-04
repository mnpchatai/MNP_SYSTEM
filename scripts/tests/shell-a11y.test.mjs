// การเข้าถึงระดับ shell ของ Pilot Web: โฟกัสหลังเปลี่ยนหน้า ชื่อแท็บ ลิงก์ข้ามไปเนื้อหา และเป้ากด 44px
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const app = read("app.js");
const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");

// ดึง focusRouteStart และ focusPageStart จาก app.js มารันจริงกับ DOM จำลอง
function loadFocusFunctions(document) {
  const start = app.indexOf("function focusRouteStart(");
  const end = app.indexOf("\n}", app.indexOf("function focusPageStart(")) + 2;
  assert.ok(start >= 0 && end > start, "focus functions found in app.js");
  const context = vm.createContext({ document });
  vm.runInContext(`${app.slice(start, end)}\nthis.api = { focusRouteStart, focusPageStart };`, context);
  return context.api;
}

function fakeDom({ withContent = true, withHeading = true, extra = [] } = {}) {
  const document = { body: { id: "" }, activeElement: null };
  document.activeElement = document.body;
  const element = (id, { visible = true } = {}) => {
    const node = {
      id,
      isConnected: true,
      attributes: new Map(),
      focus() { document.activeElement = node; },
      getClientRects: () => (visible ? [{}] : []),
      hasAttribute: (name) => node.attributes.has(name),
      setAttribute: (name, value) => node.attributes.set(name, value),
    };
    return node;
  };
  const heading = withHeading ? element("") : null;
  const content = withContent ? Object.assign(element("main-content"), { querySelector: (selector) => (selector === "h1" ? heading : null) }) : null;
  const byId = new Map(extra.map(({ id, visible }) => [id, element(id, { visible })]));
  document.querySelector = (selector) => (selector === "#main-content" ? content : null);
  document.getElementById = (id) => byId.get(id) ?? null;
  return { document, heading, content, byId, element };
}

test("a new page moves focus to its heading, which becomes focusable without entering the tab order", () => {
  const dom = fakeDom();
  const { focusRouteStart } = loadFocusFunctions(dom.document);
  focusRouteStart({ samePath: false, beforeId: "" });
  assert.equal(dom.document.activeElement, dom.heading);
  assert.equal(dom.heading.attributes.get("tabindex"), "-1");
});

test("a page that already placed focus keeps it", () => {
  const dom = fakeDom();
  const { focusRouteStart } = loadFocusFunctions(dom.document);
  const ownTarget = dom.element("queue-detail-title");
  dom.document.activeElement = ownTarget;
  focusRouteStart({ samePath: false, beforeId: "" });
  assert.equal(dom.document.activeElement, ownTarget);
});

test("a filter change on the same page returns focus to the redrawn control", () => {
  const dom = fakeDom({ extra: [{ id: "request-filter-status", visible: true }] });
  const { focusRouteStart } = loadFocusFunctions(dom.document);
  focusRouteStart({ samePath: true, beforeId: "request-filter-status" });
  assert.equal(dom.document.activeElement, dom.byId.get("request-filter-status"));
});

test("the same control on another page, or a hidden one, does not hold focus", () => {
  const other = fakeDom({ extra: [{ id: "request-filter-status", visible: true }] });
  loadFocusFunctions(other.document).focusRouteStart({ samePath: false, beforeId: "request-filter-status" });
  assert.equal(other.document.activeElement, other.heading, "another page starts at its heading");

  const hidden = fakeDom({ extra: [{ id: "request-filter-status", visible: false }] });
  loadFocusFunctions(hidden.document).focusRouteStart({ samePath: true, beforeId: "request-filter-status" });
  assert.equal(hidden.document.activeElement, hidden.heading, "a control that is no longer shown is skipped");
});

test("a page without a heading focuses the content region, and pages outside the shell are left alone", () => {
  const noHeading = fakeDom({ withHeading: false });
  loadFocusFunctions(noHeading.document).focusRouteStart({ samePath: false, beforeId: "" });
  assert.equal(noHeading.document.activeElement, noHeading.content);

  const signIn = fakeDom({ withContent: false });
  loadFocusFunctions(signIn.document).focusRouteStart({ samePath: false, beforeId: "" });
  assert.equal(signIn.document.activeElement, signIn.document.body);
});

test("the shell names the tab, offers a skip link and marks the content as the focus target", () => {
  assert.match(app, /document\.title = `\$\{tabTitle\} · MNP Workspace`;/);
  assert.match(app, /document\.title = "เข้าสู่ระบบ · MNP Workspace";/, "signing out does not leave the last page's name on the tab");
  assert.match(app, /<div class="app-shell">\s*<a class="skip-link" href="#main-content" data-skip-link>ข้ามไปเนื้อหาหลัก<\/a>\s*<button class="mobile-nav-toggle"/, "the skip link is the first stop in the shell");
  assert.match(app, /<div class="content" id="main-content" tabindex="-1">/);
  assert.match(app, /window\.addEventListener\("hashchange", navigateRoute\);/);
  assert.doesNotMatch(app, /addEventListener\("hashchange", renderRoute\)/, "page changes go through navigateRoute, which moves focus");
  assert.match(app, /if \(seq !== routeSeq\) return;/, "only the latest page change moves focus");
});

test("the request detail page attaches files with the same Thai picker as the forms", () => {
  const form = app.match(/<form id="attachment-form">[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.match(form, /<label class="btn secondary file-pick" for="attachment-file">\$\{uiIcon\("download"\)\} ถ่ายรูป \/ เลือกไฟล์<\/label>/);
  assert.match(form, /<input class="file-pick-input" id="attachment-file" name="file" type="file"/);
  assert.doesNotMatch(form, /\brequired\b/, "the visually hidden input must not show the browser's English required bubble");
});

function minHeight(selector) {
  let found = null;
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(",").map((part) => part.trim().replace(/\s+/g, " ")).includes(selector)) continue;
    const value = body.match(/(?:^|;)\s*min-height:\s*([^;]+)/)?.[1];
    if (value) found = value.trim();
  }
  return found;
}

test("touch targets the critique flagged reach 44px (gloves on the factory floor)", () => {
  for (const selector of [".date-pick-day", ".date-pick-foot .btn", ".confirm-dialog-actions .btn", ".attachment-upload", ".skip-link"]) {
    assert.equal(minHeight(selector), "44px", `${selector} min-height`);
  }
});
