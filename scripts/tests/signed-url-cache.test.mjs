// ทดสอบการจำ signed URL ของไฟล์แนบใน sessionStorage (app.js: loadSignedAttachmentUrls / saveSignedAttachmentUrls)
// app.js โหลดทั้งไฟล์ใน Node ไม่ได้ จึงตัดเฉพาะช่วงโค้ดนี้มารันใน context จำลอง
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync("app.js", "utf8");
const start = source.indexOf("const SIGNED_URL_STORAGE_KEY");
const end = source.indexOf("const TEXT_PREVIEW_LIMIT");
const saved = (owner, entries) => JSON.stringify({ owner, entries });
assert.ok(start > 0 && end > start, "signed URL cache block not found in app.js");
const block = `${source.slice(start, end)}; globalThis.api = { signedAttachmentUrls, saveSignedAttachmentUrls, syncSignedUrlOwner, SIGNED_URL_STORAGE_KEY, owner: () => signedUrlOwner };`;

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
  const { signedAttachmentUrls, owner } = load(saved("user-a", [
    ["request-attachments/a.jpg", { url: "https://x/a", expiresAt: now + 60_000 }],
    ["request-attachments/b.jpg", { url: "https://x/b", expiresAt: now - 1 }],
    ["request-attachments/c.jpg", { expiresAt: now + 60_000 }],
  ]));
  assert.deepEqual([...signedAttachmentUrls.keys()], ["request-attachments/a.jpg"]);
  assert.equal(owner(), "user-a");
});

test("starts empty when storage is unreadable or corrupt", () => {
  assert.equal(load("not json").signedAttachmentUrls.size, 0);
  assert.equal(load(JSON.stringify({ a: 1 })).signedAttachmentUrls.size, 0);
  assert.equal(load(JSON.stringify([["k", { url: "u", expiresAt: Date.now() + 1000 }]])).signedAttachmentUrls.size, 0, "old array format");
  assert.equal(load(undefined, { broken: true }).signedAttachmentUrls.size, 0);
});

test("save writes live entries for the owner and removes the key once the cache is cleared (sign-out)", () => {
  const { signedAttachmentUrls, saveSignedAttachmentUrls, syncSignedUrlOwner, SIGNED_URL_STORAGE_KEY, store } = load(undefined);
  syncSignedUrlOwner("user-a");
  signedAttachmentUrls.set("ncr-attachments/n.pdf", { url: "https://x/n", expiresAt: Date.now() + 60_000 });
  signedAttachmentUrls.set("ncr-attachments/old.pdf", { url: "https://x/o", expiresAt: Date.now() - 1 });
  saveSignedAttachmentUrls();
  const written = JSON.parse(store.get(SIGNED_URL_STORAGE_KEY));
  assert.equal(written.owner, "user-a");
  assert.deepEqual(written.entries.map(([key]) => key), ["ncr-attachments/n.pdf"]);
  syncSignedUrlOwner(null);
  assert.equal(signedAttachmentUrls.size, 0);
  assert.equal(store.has(SIGNED_URL_STORAGE_KEY), false);
});

test("a different user in the same tab never reuses the previous user's URLs", () => {
  const entry = ["request-attachments/a.jpg", { url: "https://x/a", expiresAt: Date.now() + 60_000 }];
  const same = load(saved("user-a", [entry]));
  same.syncSignedUrlOwner("user-a");
  assert.equal(same.signedAttachmentUrls.size, 1, "same user keeps the cache after reload");
  const other = load(saved("user-a", [entry]));
  other.syncSignedUrlOwner("user-b");
  assert.equal(other.signedAttachmentUrls.size, 0);
  assert.equal(other.owner(), "user-b");
});

test("nothing is persisted before an owner is known, and a full storage does not throw", () => {
  const { signedAttachmentUrls, saveSignedAttachmentUrls, SIGNED_URL_STORAGE_KEY, store } = load(undefined);
  signedAttachmentUrls.set("k", { url: "u", expiresAt: Date.now() + 60_000 });
  saveSignedAttachmentUrls();
  assert.equal(store.has(SIGNED_URL_STORAGE_KEY), false);
  const full = load(undefined, { broken: true });
  full.signedAttachmentUrls.set("k", { url: "u", expiresAt: Date.now() + 60_000 });
  assert.doesNotThrow(() => full.syncSignedUrlOwner("user-a"));
});
