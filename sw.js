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
// url เป็น hash route สัมพัทธ์ (เช่น "#/request?id=...") แปลงเป็น URL เต็มด้วย scope ของ service worker เสมอ
// เพราะ Pilot เปิดได้ทั้งจาก /MNP_SYSTEM/ (GitHub Pages) และ / (Cloudflare Workers)
// ทุก push ต้องจบด้วย showNotification (iOS ยกเลิกการสมัครของเว็บที่รับ push แล้วไม่แสดงอะไร)
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "มีการแจ้งเตือนใหม่";
  const url = typeof data.url === "string" && data.url.startsWith("#/") ? data.url : "#/notifications";
  event.waitUntil(self.registration.showNotification(title, {
    icon: "./icons/icon-192.png",
    lang: "th",
    ...(typeof data.tag === "string" && data.tag ? { tag: data.tag } : {}),
    data: { url },
  }));
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
