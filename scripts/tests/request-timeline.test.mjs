import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

// src/lib ใช้ alias "@/..." ของ tsconfig — แปลงเป็นไฟล์ .ts ใน src/ ให้ Node โหลดได้ (Node 22 ตัด type ให้เอง)
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    const result = specifier.startsWith("@/")
      ? await next(new URL("src/" + specifier.slice(2) + ".ts", ${JSON.stringify(new URL("../../", import.meta.url).href)}).href, context)
      : await next(specifier, context);
    return result.url.endsWith(".ts") ? { ...result, format: "module-typescript" } : result;
  }
`)}`);
const { buildRequestTimeline } = await import("../../src/lib/request-timeline.ts");

const person = (first_name, last_name) => ({ first_name, last_name });
const approver = person("รสริน", "เชน");
const requester = person("จุฑารัตน์", "ท่าฉลาด");
const history = (id, from_status, to_status, created_at, changed_by_employee, note = null) => (
  { id, from_status, to_status, created_at, changed_by_employee, note }
);
const build = ({ steps = [], rows }) => buildRequestTimeline({
  request: { assignee: null },
  history: rows,
  steps,
  verifications: [],
  isRepair: true,
});

test("every more-info request and reply shows that person's own message, round after round", () => {
  const events = build({
    steps: [{
      id: "s2", step_order: 2, step_name: "ผู้จัดการทั่วไป", status: "pending",
      acted_at: null, created_at: "2026-10-03T08:00:00Z", comment: "ขอรายละเอียดราคา | ตอบกลับ: ราคา 5,000 บาท", acted_by_employee: null,
    }],
    rows: [
      history("h1", "pending_approval", "more_info", "2026-10-04T15:31:00Z", approver, "ขอใบเสนอราคา"),
      history("h2", "more_info", "pending_approval", "2026-10-05T00:40:00Z", requester, "แนบใบเสนอราคาแล้ว"),
      history("h3", "pending_approval", "more_info", "2026-10-05T01:54:00Z", approver, "ขอรายละเอียดราคา"),
      history("h4", "more_info", "pending_approval", "2026-10-05T02:06:00Z", requester, "ราคา 5,000 บาท"),
    ],
  });
  assert.deepEqual(events.map(({ detail, message }) => [detail, message]), [
    ["รสริน เชน ขอข้อมูลเพิ่มเติม", "ขอใบเสนอราคา"],
    ["จุฑารัตน์ ท่าฉลาด ส่งข้อมูลเพิ่มเติมเพื่อพิจารณาอีกครั้ง", "แนบใบเสนอราคาแล้ว"],
    ["รสริน เชน ขอข้อมูลเพิ่มเติม", "ขอรายละเอียดราคา"],
    ["จุฑารัตน์ ท่าฉลาด ส่งข้อมูลเพิ่มเติมเพื่อพิจารณาอีกครั้ง", "ราคา 5,000 บาท"],
  ]);
});

test("a reply without a message shows no empty quote", () => {
  const [event] = build({ rows: [history("h1", "more_info", "pending_approval", "2026-10-05T02:06:00Z", requester)] });
  assert.equal(event.detail, "จุฑารัตน์ ท่าฉลาด ส่งข้อมูลเพิ่มเติมเพื่อพิจารณาอีกครั้ง");
  assert.equal(event.message, undefined);
});

test("an older row without a note falls back to the comment of the step decided at that time", () => {
  const [event] = build({
    steps: [{
      id: "s1", step_order: 1, step_name: "ผู้จัดการโรงงาน", status: "rejected",
      acted_at: "2026-10-05T03:00:00Z", created_at: "2026-10-03T08:00:00Z", comment: "งบประมาณไม่พอ", acted_by_employee: approver,
    }],
    rows: [history("h1", "pending_approval", "rejected", "2026-10-05T03:00:00.200Z", approver)],
  });
  assert.equal(event.detail, "รสริน เชน ไม่อนุมัติ ในขั้น ผู้จัดการโรงงาน");
  assert.equal(event.message, "งบประมาณไม่พอ");
});

test("intermediate and final approval comments become messages; system notes stay in the detail", () => {
  const events = build({
    steps: [
      {
        id: "s1", step_order: 1, step_name: "ผู้จัดการโรงงาน", status: "approved",
        acted_at: "2026-10-05T01:00:00Z", created_at: "2026-10-03T08:00:00Z", comment: "ผ่านขั้นโรงงาน", acted_by_employee: approver,
      },
      {
        id: "s2", step_order: 2, step_name: "ผู้จัดการทั่วไป", status: "approved",
        acted_at: "2026-10-05T04:00:00Z", created_at: "2026-10-03T08:00:00Z", comment: "อนุมัติตามเสนอ", acted_by_employee: approver,
      },
    ],
    rows: [
      history("h1", "pending_assign", "pending_approval", "2026-10-05T02:00:00Z", null, "ย้อนกลับมารออนุมัติ: ขาดขั้นอนุมัติ"),
      history("h2", "pending_approval", "pending_assign", "2026-10-05T04:00:00Z", approver, "อนุมัติตามเสนอ"),
    ],
  });
  assert.deepEqual(events.map(({ id, detail, message }) => [id, detail, message]), [
    ["approval-s1", "รสริน เชน อนุมัติขั้น ผู้จัดการโรงงาน แล้ว", "ผ่านขั้นโรงงาน"],
    ["status-h1", "ระบบ ย้อนกลับไปรออนุมัติ · ย้อนกลับมารออนุมัติ: ขาดขั้นอนุมัติ", undefined],
    ["status-h2", "รสริน เชน อนุมัติขั้น ผู้จัดการทั่วไป แล้ว", "อนุมัติตามเสนอ"],
  ]);
});

test("files attached together or right after an action show as one event naming the uploader", () => {
  const events = buildRequestTimeline({
    request: { assignee: null },
    history: [],
    steps: [],
    verifications: [],
    isRepair: true,
    attachments: [
      { id: "f2", file_name: "quote-2.pdf", created_at: "2026-10-05T02:06:30Z", uploader: requester },
      { id: "f1", file_name: "quote-1.pdf", created_at: "2026-10-05T02:06:10Z", uploader: requester },
      { id: "f3", file_name: "photo.jpg", created_at: "2026-10-05T02:06:40Z", uploader: approver },
      { id: "f4", file_name: "later.pdf", created_at: "2026-10-05T03:30:00Z", uploader: requester },
    ],
  });
  assert.deepEqual(events.map(({ title, detail }) => [title, detail]), [
    ["แนบไฟล์", "จุฑารัตน์ ท่าฉลาด แนบไฟล์ 2 ไฟล์: quote-1.pdf, quote-2.pdf"],
    ["แนบไฟล์", "รสริน เชน แนบไฟล์ 1 ไฟล์: photo.jpg"],
    ["แนบไฟล์", "จุฑารัตน์ ท่าฉลาด แนบไฟล์ 1 ไฟล์: later.pdf"],
  ]);
});

test("attachments are optional and keep chronological order with status events", () => {
  const events = build({ rows: [history("h1", "more_info", "pending_approval", "2026-10-05T02:06:00Z", requester, "แนบใบเสนอราคาแล้ว")] });
  assert.equal(events.length, 1);
  const mixed = buildRequestTimeline({
    request: { assignee: null },
    history: [history("h1", "more_info", "pending_approval", "2026-10-05T02:06:00Z", requester, "แนบใบเสนอราคาแล้ว")],
    steps: [],
    verifications: [],
    isRepair: true,
    attachments: [{ id: "f1", file_name: "quote.pdf", created_at: "2026-10-05T02:06:05Z", uploader: requester }],
  });
  assert.deepEqual(mixed.map((event) => event.title), ["รออนุมัติ", "แนบไฟล์"]);
});
