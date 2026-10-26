// Service worker ของ Pilot Web
//
// มีไว้เพื่อให้ Chrome/Edge ถือว่าเว็บนี้ติดตั้งได้ (ส่ง beforeinstallprompt ให้ปุ่ม "ติดตั้งแอป") และเป็นที่รับ
// Web Push ในอนาคต — ตั้งใจไม่ cache ไฟล์ใดเลย หน้าเว็บโหลดจากเซิร์ฟเวอร์ทุกครั้งเหมือนไม่มี service worker
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
