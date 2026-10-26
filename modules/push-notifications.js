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

  const api = { pushPanelState, urlBase64ToUint8Array, subscriptionRecord, sameApplicationServerKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.MNP_PUSH = api;
})();
