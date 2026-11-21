// Service worker ของ Pilot Web
//
// มีไว้เพื่อ (1) ให้ Chrome/Edge ถือว่าเว็บนี้ติดตั้งได้ (ส่ง beforeinstallprompt ให้ปุ่ม "ติดตั้งแอป")
// และ (2) รับ Web Push แสดงแจ้งเตือนบนหน้าจอเครื่อง (push / notificationclick ท้ายไฟล์)
// ตั้งใจไม่ cache ไฟล์ใดเลย หน้าเว็บโหลดจากเซิร์ฟเวอร์ทุกครั้งเหมือนไม่มี service worker
// จึงไม่มีไฟล์รุ่นเก่าค้างในเครื่องหลัง deploy (การเปลี่ยนรุ่นยังคุมด้วย ?v= ใน index.html เหมือนเดิม)
// และไม่มีข้อมูลจาก Supabase ถูกเก็บไว้ในเครื่อง
// จับเฉพาะการเปิดหน้า (navigate): ออนไลน์ส่งต่อให้เครือข่าย ออฟไลน์แสดงหน้าแจ้งแทนหน้า error ของเบราว์เซอร์

const OFFLINE_PAGE = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MNP Workspace</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-content:center;gap:8px;padding:24px;text-align:center;font-family:system-ui,sans-serif;color:#344054;background:#f5f7fb">
<h1 style="margin:0;font-size:20px">ไม่มีการเชื่อมต่ออินเทอร์เน็ต</h1>
<p style="margin:0">MNP Workspace ต้องใช้อินเทอร์เน็ต ตรวจสอบการเชื่อมต่อแล้วเปิดใหม่อีกครั้ง</p>
</body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE_PAGE, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })),
  );
});

// ---------- Web Push ----------
// payload จาก Edge Function notify-push: { title, url, tag } — title คือหัวเรื่องแจ้งเตือน + เลขที่เอกสาร ไม่มีรายละเอียดอื่น
// Push สรุปหลังครบเวลาพักมี body เพิ่ม ({ title, body, url, tag }) — แสดง body เมื่อมีเท่านั้น แจ้งเตือนปกติจึงไม่เปลี่ยน
// url เป็น hash route สัมพัทธ์ (เช่น "#/request?id=...") แปลงเป็น URL เต็มด้วย scope ของ service worker เสมอ
// เพราะ Pilot เปิดได้ทั้งจาก /MNP_SYSTEM/ (GitHub Pages) และ / (Cloudflare Workers)
// ทุก push ต้องจบด้วย showNotification (iOS ยกเลิกการสมัครของเว็บที่รับ push แล้วไม่แสดงอะไร)
//
// เสียงของบริษัทตอนเปิดแอปอยู่ (modules/notification-sound.js): ทุกหน้าของแอปที่เปิดอยู่ได้ข้อความ "mnp-notification"
// ไปรีเฟรชตัวเลขกระดิ่ง ส่วนหน้าที่ "มองเห็นและโฟกัสอยู่" จะถูกถามด้วยว่าจะเล่นเสียงของบริษัทเองไหม
// ถ้าตอบว่าเล่น (willPlaySound) แจ้งเตือนบนหน้าจอจะเป็นแบบ silent เพื่อไม่ให้ดังซ้อนกับเสียงของระบบปฏิบัติการ
// ถ้าไม่มีหน้าที่ตอบรับทันเวลา/ตอบไม่ → ไม่ silent (ยอมให้ดังซ้อนดีกว่าไม่มีเสียงเลย) · ขั้นนี้พังอย่างไรก็ต้องยังแสดงแจ้งเตือน
const PAGE_REPLY_TIMEOUT_MS = 1000;

// ส่งข้อความหาหน้าหนึ่งหน้า พร้อมช่องทางให้ตอบกลับ (MessageChannel) — คืน true เมื่อหน้านั้นตอบว่าจะเล่นเสียงเอง
function askPageToPlaySound(client, message) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let timer = 0;
    const finish = (value) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(value);
    };
    timer = setTimeout(() => finish(false), PAGE_REPLY_TIMEOUT_MS);
    channel.port1.onmessage = (reply) => finish(reply.data?.willPlaySound === true);
    try {
      client.postMessage(message, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

// บอกทุกหน้าของแอปที่เปิดอยู่ว่ามีแจ้งเตือนใหม่ · คืน true เมื่อมีหน้าที่มองเห็น+โฟกัสอยู่รับปากว่าจะเล่นเสียงเอง (→ ทำแจ้งเตือนเป็น silent)
async function announceToOpenPages(payload) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const message = { type: "mnp-notification", ...payload };
  const answers = windows
    .filter((client) => client.url.startsWith(self.registration.scope))
    .map((client) => {
      if (client.visibilityState === "visible" && client.focused) return askPageToPlaySound(client, message);
      try {
        client.postMessage(message);
      } catch {
        // หน้านี้รับข้อความไม่ได้ ข้ามไป
      }
      return false;
    });
  return (await Promise.all(answers)).some(Boolean);
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "มีการแจ้งเตือนใหม่";
  const url = typeof data.url === "string" && data.url.startsWith("#/") ? data.url : "#/notifications";
  const body = typeof data.body === "string" ? data.body : "";
  // ทุกแจ้งเตือนต้องมี tag ที่หน้าเว็บรู้ด้วย: ถ้าหน้ารับปากเล่นเสียงแล้วเล่นไม่ได้ จะแสดงแจ้งเตือนสำรองด้วย tag เดิมเพื่อทับใบ silent (ไม่ขึ้น 2 ใบ)
  // payload ไม่มี tag → สร้างให้ไม่ซ้ำกัน (เหมือนเดิมที่แจ้งเตือนไม่มี tag จะแยกเป็นคนละใบ)
  const tag = typeof data.tag === "string" && data.tag ? data.tag : `mnp-push-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  event.waitUntil((async () => {
    let silent = false;
    try {
      silent = await announceToOpenPages({ title, ...(body ? { body } : {}), url, tag });
    } catch {
      silent = false;
    }
    await self.registration.showNotification(title, {
      icon: "./icons/icon-192.png",
      lang: "th",
      ...(body ? { body } : {}),
      tag,
      ...(silent ? { silent: true } : {}),
      data: { url },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? "#/notifications", self.registration.scope).href;
  event.waitUntil((async () => {
    // เฉพาะหน้าต่างที่ service worker นี้ควบคุมอยู่ (ไม่ใส่ includeUncontrolled) เพราะ navigate() ใช้ได้กับหน้าเหล่านั้นเท่านั้น
    // หน้าที่เปิดค้างไว้ก่อนมี service worker จะได้หน้าต่างใหม่แทนการพยายามพาหน้าเดิมไปแล้วเปิดซ้ำอีกอัน
    const windows = await self.clients.matchAll({ type: "window" });
    const open = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (open) {
      // navigate ก่อนแล้วค่อย focus: เปลี่ยนแค่ hash ในหน้าเดิม แอปรับ hashchange แล้วเปิดหน้านั้นเอง ไม่โหลดหน้าใหม่
      let navigated = null;
      try {
        navigated = await open.navigate(target);
      } catch {
        // navigate ใช้ไม่ได้ → เปิดหน้าต่างใหม่แทน (ด้านล่าง)
      }
      if (navigated) {
        // focus ไม่สำเร็จก็ไม่เปิดหน้าต่างซ้ำ เพราะหน้าถูกพาไปที่ปลายทางแล้ว
        await navigated.focus().catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
