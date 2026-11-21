// ส่วนที่เป็นกติกาล้วน ๆ ของการแจ้งเตือนบนเครื่อง (Web Push) ที่หน้าการแจ้งเตือนใน app.js ใช้
// (ทดสอบด้วย node: scripts/tests/push-notifications.test.mjs) — ส่วนที่แตะเบราว์เซอร์/Supabase อยู่ใน app.js
(function () {
  // ตัดสินว่าแผงบนหน้าการแจ้งเตือนต้องแสดงสถานะไหน
  //   hidden       ยังไม่ได้ตั้งกุญแจ VAPID ในแอป — ไม่แสดงอะไรเลย
  //   ios-install  iPhone/iPad ที่เปิดจากแท็บ Safari: Apple ให้เว็บรับแจ้งเตือนได้เฉพาะแอปที่เพิ่มลงหน้าจอโฮมแล้ว (iOS 16.4+)
  //   ios-old      เปิดจากแอปบนหน้าจอโฮมแล้วแต่ไม่มี Push API = iOS เก่ากว่า 16.4
  //   unsupported  เบราว์เซอร์อื่นที่ไม่รองรับ
  //   denied       ผู้ใช้/เครื่องบล็อกการแจ้งเตือนของเว็บนี้ไว้ — เว็บขออนุญาตซ้ำไม่ได้ ต้องเปิดเองในการตั้งค่า
  //   on           เครื่องนี้ลงทะเบียนรับแจ้งเตือนอยู่และฐานข้อมูลรู้จักเครื่องนี้
  //   off          ยังไม่เปิด (รวมกรณีอนุญาตแล้วแต่ยังไม่ได้ลงทะเบียน/ฐานข้อมูลไม่รู้จัก — กดปุ่มเพื่อลงทะเบียนใหม่)
  function pushPanelState({ keyConfigured = false, hasServiceWorker = false, hasPushManager = false, hasNotification = false, ios = false, standalone = false, permission = "default", subscribed = false } = {}) {
    if (!keyConfigured) return "hidden";
    if (ios && !standalone) return "ios-install";
    if (!hasServiceWorker || !hasPushManager || !hasNotification) return ios ? "ios-old" : "unsupported";
    if (permission === "denied") return "denied";
    if (permission === "granted" && subscribed) return "on";
    return "off";
  }

  // กุญแจสาธารณะ VAPID เป็น base64url → ไบต์ สำหรับ pushManager.subscribe({ applicationServerKey })
  function urlBase64ToUint8Array(value) {
    const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  // ค่าที่ส่งให้ฐานข้อมูลจาก PushSubscription.toJSON() — คืน null ถ้าไม่ครบ (ไม่ส่งข้อมูลที่ไม่สมบูรณ์ขึ้นไป)
  function subscriptionRecord(json) {
    const endpoint = json?.endpoint;
    const p256dh = json?.keys?.p256dh;
    const auth = json?.keys?.auth;
    if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") return null;
    if (!endpoint || !p256dh || !auth) return null;
    return { endpoint, p256dh, auth };
  }

  // subscription เดิมผูกกับกุญแจ VAPID ตัวที่ใช้ตอนสมัคร ถ้าเปลี่ยนกุญแจในแอป ต้องสมัครใหม่ ไม่งั้น push service ปฏิเสธ (403)
  function sameApplicationServerKey(existingKey, expectedBytes) {
    if (!existingKey) return false;
    const actual = new Uint8Array(existingKey);
    return actual.length === expectedBytes.length && actual.every((byte, index) => byte === expectedBytes[index]);
  }

  // เวลาใน "แถบบนเครื่องนี้" ใช้กติกาเดียวกับการพักแจ้งเตือนในฐานข้อมูล (private.push_pause_end): 07:00 น. เวลาไทย "รอบถัดไปที่จะถึง"
  // ไทยคือ UTC+7 ไม่มี DST จึงคำนวณจากมิลลิวินาทีได้ตรง ๆ โดยไม่ขึ้นกับเขตเวลาของเครื่อง
  //   กด 20:00 → 07:00 วันรุ่งขึ้น · กด 00:30 หรือ 06:59 → 07:00 เช้าวันเดียวกัน · กด 07:00:00 พอดีหรือหลังจากนั้น → 07:00 วันถัดไป
  const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  function nextBangkokSevenAm(nowMs) {
    const bangkokDayStart = Math.floor((nowMs + BANGKOK_OFFSET_MS) / DAY_MS) * DAY_MS;
    const sevenAmToday = bangkokDayStart + 7 * 60 * 60 * 1000 - BANGKOK_OFFSET_MS;
    // เลย 07:00 ของวันนี้ไปแล้ว (รวม 07:00:00 พอดี) → รอบถัดไปคือพรุ่งนี้ ผลจึงมากกว่า nowMs เสมอ
    return nowMs >= sevenAmToday ? sevenAmToday + DAY_MS : sevenAmToday;
  }

  // ค่าที่เก็บไว้ว่า "ซ่อนแถบถึงเมื่อไร" (มิลลิวินาที เป็นข้อความ) → เวลาสิ้นสุดที่ยังไม่ถึง หรือ null เมื่อไม่มี/เลยเวลาแล้ว/ค่าเพี้ยน
  // ค่าที่ไกลเกินกว่าที่เราตั้งได้ (เกิน 2 วัน เช่น ถูกแก้ในเครื่อง) ไม่เชื่อ ไม่งั้นแถบอาจหายถาวร
  function activeHiddenUntil(stored, nowMs) {
    const until = Number(stored);
    if (stored == null || stored === "" || !Number.isFinite(until)) return null;
    return until > nowMs && until <= nowMs + 2 * DAY_MS ? until : null;
  }

  // ฐานข้อมูลยังไม่ได้ apply migration ที่มีฟังก์ชันนี้ (หน้าเว็บขึ้นก่อนฐานข้อมูล) → PostgREST ตอบ PGRST202 / 42883 / 404
  // หน้าเว็บใช้แยก "ยังไม่มีฟังก์ชัน" (ซ่อนปุ่ม ถือว่าไม่ได้พัก เงียบ) ออกจากข้อผิดพลาดอื่น (เน็ตหลุด/ไม่มีสิทธิ์)
  function isMissingFunctionError(error) {
    if (!error) return false;
    const code = String(error.code ?? "");
    if (code === "PGRST202" || code === "42883") return true;
    if (error.status === 404 || error.statusCode === 404) return true;
    return /could not find the function/i.test(String(error.message ?? ""));
  }

  // แถบบังคับด้านบนของหน้า: แสดงจนกว่าเครื่องนี้จะเปิดแจ้งเตือนสำเร็จ (อนุญาตแล้ว + ลงทะเบียนแล้ว) คืนชนิดของแถบ หรือ null = ไม่แสดง
  // ผู้ใช้กด "ปิดชั่วคราววันนี้" ได้ (environment.hidden = true) → ไม่แสดงจนถึง 07:00 น. รอบถัดไป · กำลังพักแจ้งเตือน (environment.paused = true) ก็ไม่แสดง
  //   enable       ใช้ Push ได้แต่ยังไม่เปิด (ยังไม่เคยตอบ หรืออนุญาตแล้วแต่ยังไม่ลงทะเบียน) → ข้อความ + ปุ่มเปิด
  //   denied       เครื่องบล็อกไว้ เว็บขอซ้ำไม่ได้ → ข้อความบอกวิธีแก้ ไม่มีปุ่มเปิด
  //   ios-install  iPhone/iPad ที่ยังไม่ได้เพิ่มลงหน้าจอโฮม → ข้อความแนะนำ ไม่มีปุ่มเปิด
  //   pending      อนุญาตแล้วแต่ยังไม่รู้ว่าฐานข้อมูลรู้จักเครื่องนี้ไหม (environment.subscribed เป็น null/ไม่มีค่า) → ยังไม่แสดง รอตรวจก่อน
  //   hidden/ios-old/unsupported (แก้ไม่ได้) และ on → null
  function pushPromptKind(environment) {
    if (environment?.hidden || environment?.paused) return null;
    const panel = pushPanelState(environment);
    if (panel === "denied" || panel === "ios-install") return panel;
    if (panel !== "off") return null;
    if (environment?.permission === "granted" && environment.subscribed == null) return "pending";
    return "enable";
  }

  const api = { pushPanelState, urlBase64ToUint8Array, subscriptionRecord, sameApplicationServerKey, pushPromptKind, nextBangkokSevenAm, activeHiddenUntil, isMissingFunctionError };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.MNP_PUSH = api;
})();
