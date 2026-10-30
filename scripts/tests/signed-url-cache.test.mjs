// ทดสอบการจำ signed URL ของไฟล์แนบใน sessionStorage (app.js: loadSignedAttachmentUrls / saveSignedAttachmentUrls)
// app.js โหลดทั้งไฟล์ใน Node ไม่ได้ จึงตัดเฉพาะช่วงโค้ดนี้มารันใน context จำลอง
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync("app.js", "utf8");
const start = source.indexOf("const SIGNED_URL_STORAGE_KEY");
const end = source.indexOf("const TEXT_PREVIEW_LIMIT");
assert.ok(start > 0 && end > start, "signed URL cache block not found in app.js");
const block = `${source.slice(start, end)}; globalThis.api = { signedAttachmentUrls, saveSignedAttachmentUrls, SIGNED_URL_STORAGE_KEY };`;

function load(initial, { broken = false } = {}) {
  const store = new Map(initial === undefined ? [] : [["mnp-signed-attachment-urls", initial]]);
  const sessionStorage = {
    getItem: (key) => { if (broken) throw new Error("blocked"); return store.get(key) ?? null; },
    setItem: (key, value) => { if (broken) throw new Error("blocked"); store.set(key, value); },
    removeItem: (key) => store.delete(key),
  };
  const context = vm.createContext({ sessionStorage, Date, JSON, Map, Array, Number });
  vm.runInContext(block, context);
  return { ...context.api, store };
}

test("restores unexpired URLs after a reload and drops expired or malformed entries", () => {
  const now = Date.now();
  const saved = JSON.stringify([
    ["request-attachments/a.jpg", { url: "https://x/a", expiresAt: now + 60_000 }],
    ["request-attachments/b.jpg", { url: "https://x/b", expiresAt: now - 1 }],
    ["request-attachments/c.jpg", { expiresAt: now + 60_000 }],
  ]);
  const { signedAttachmentUrls } = load(saved);
  assert.deepEqual([...signedAttachmentUrls.keys()], ["request-attachments/a.jpg"]);
});

test("starts empty when storage is unreadable or corrupt", () => {
  assert.equal(load("not json").signedAttachmentUrls.size, 0);
  assert.equal(load(JSON.stringify({ a: 1 })).signedAttachmentUrls.size, 0);
  assert.equal(load(undefined, { broken: true }).signedAttachmentUrls.size, 0);
});

test("save writes live entries and removes the key once the cache is cleared (sign-out)", () => {
  const { signedAttachmentUrls, saveSignedAttachmentUrls, SIGNED_URL_STORAGE_KEY, store } = load(undefined);
  signedAttachmentUrls.set("ncr-attachments/n.pdf", { url: "https://x/n", expiresAt: Date.now() + 60_000 });
  signedAttachmentUrls.set("ncr-attachments/old.pdf", { url: "https://x/o", expiresAt: Date.now() - 1 });
  saveSignedAttachmentUrls();
  assert.deepEqual(JSON.parse(store.get(SIGNED_URL_STORAGE_KEY)).map(([key]) => key), ["ncr-attachments/n.pdf"]);
  signedAttachmentUrls.clear();
  saveSignedAttachmentUrls();
  assert.equal(store.has(SIGNED_URL_STORAGE_KEY), false);
});
