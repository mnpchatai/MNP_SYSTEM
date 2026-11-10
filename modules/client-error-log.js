// บันทึกข้อผิดพลาดที่ผู้ใช้เจอจริงใน Pilot Web ส่งให้บัญชี master ดูที่ #/master
//
// แหล่งที่จับ: friendlyError ของ app.js (ข้อผิดพลาดที่แสดงให้ผู้ใช้เห็นทุกจุด), window "error" และ
// "unhandledrejection" (โค้ดพังโดยไม่มีใครจับ) ส่งผ่าน RPC app_log_client_error เท่านั้น
// (migration 20261113010000_master_account.sql) ฐานข้อมูลตัดโทเค็น จำกัดจำนวน และข้ามรายการซ้ำอีกชั้น
//
// ความเป็นส่วนตัว: ส่งเฉพาะชนิด รหัส ข้อความ ชื่อหน้า (ไม่รวม query string ของ URL ซึ่งอาจมีโทเค็นของลิงก์
// ตั้งรหัสผ่าน) รายละเอียดสั้น ๆ เวอร์ชันหน้าเว็บ และ user agent ไม่ส่งค่าที่ผู้ใช้กรอกในฟอร์ม
// ข้อความที่ดูเหมือนรหัสผ่าน/โทเค็นถูกแทนที่ก่อนส่ง ไม่ส่งเมื่อยังไม่ได้ล็อกอิน
//
// การส่งล้มเหลวถูกเงียบไว้ (ไม่เรียก friendlyError ซ้ำ จึงไม่วนรายงานตัวเอง)
(function () {
  const WINDOW_MS = 10 * 60 * 1000;
  const MAX_PER_WINDOW = 20;
  const DEDUPE_MS = 60 * 1000;
  const KINDS = new Set(["js", "promise", "rpc", "network", "ui"]);
  // ข้อความที่ไม่มีประโยชน์ต่อการหาสาเหตุ หรือเกิดจากผู้ใช้ยกเลิกเอง
  // "กำลังเตรียมรูป" = ผู้ใช้กดส่งระหว่างที่รูปที่เลือกยังแปลงไม่เสร็จ (readExtraFiles ใน app.js) เป็นการรอตามปกติ ไม่ใช่ข้อผิดพลาด
  const IGNORED = [/^Script error\.?$/i, /ResizeObserver loop/i, /AbortError/i, /The user aborted a request/i, /^กำลังเตรียมรูป/];
  const NETWORK = /Failed to fetch|NetworkError|Load failed|network request failed|ERR_INTERNET_DISCONNECTED/i;

  function scrub(value, max) {
    const text = String(value ?? "")
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]")
      .replace(/(password|passwd|token|secret|apikey|api_key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1$2[ซ่อน]")
      .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, "[…]")
      .trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  // ชื่อหน้าจาก location.hash เท่านั้น ไม่รวม query string
  function pageOf(hash) {
    const path = String(hash ?? "").replace(/^#\/?/, "").split("?")[0];
    return scrub(path || "home", 100);
  }

  function describe(error, kind = null) {
    const raw = error?.reason ?? error;
    const message = scrub(raw?.message ?? (typeof raw === "string" ? raw : raw ? String(raw) : ""), 1000);
    const explicitCode = typeof raw?.code === "string" || typeof raw?.code === "number" ? String(raw.code) : "";
    const textCode = message.match(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/)?.[0] ?? "";
    const code = scrub(textCode || explicitCode, 80);
    const stack = typeof raw?.stack === "string" ? raw.stack.split("\n").slice(0, 6).join("\n") : "";
    // ไม่ส่ง details ของ PostgREST: มักมีค่าที่ผู้ใช้กรอก (เช่น "Key (email)=(…)", "Failing row contains (…)")
    const detail = scrub([raw?.hint, stack].filter(Boolean).join("\n"), 4000);
    let resolvedKind = KINDS.has(kind) ? kind : null;
    if (!resolvedKind) {
      if (NETWORK.test(message)) resolvedKind = "network";
      else if (explicitCode || textCode) resolvedKind = "rpc";
      else resolvedKind = "ui";
    }
    return { kind: resolvedKind, code, message, detail };
  }

  // report(error, { kind, page }) → payload ที่ส่ง หรือ null เมื่อข้าม (ว่าง, ไม่มีประโยชน์, ซ้ำ, เกินโควตา)
  function createReporter({ send, now = () => Date.now(), page = () => "" } = {}) {
    const recent = new Map();
    const sentAt = [];
    return function report(error, context = {}) {
      const described = describe(error, context.kind);
      if (!described.message || IGNORED.some((pattern) => pattern.test(described.message))) return null;
      const at = now();
      const pageName = context.page ?? page();
      const key = `${described.kind}|${described.code}|${described.message}|${pageName}`;
      if (at - (recent.get(key) ?? -Infinity) < DEDUPE_MS) return null;
      while (sentAt.length && at - sentAt[0] >= WINDOW_MS) sentAt.shift();
      if (sentAt.length >= MAX_PER_WINDOW) return null;
      recent.set(key, at);
      if (recent.size > 200) recent.delete(recent.keys().next().value);
      sentAt.push(at);
      const payload = { ...described, page: pageName };
      try {
        Promise.resolve(send(payload)).catch(() => {});
      } catch {
        // เงียบไว้: การรายงานต้องไม่ทำให้หน้าเว็บพังเพิ่ม
      }
      return payload;
    };
  }

  const api = { scrub, pageOf, describe, createReporter, MAX_PER_WINDOW, DEDUPE_MS };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  // เบราว์เซอร์: state, sb, APP_VERSION เป็นตัวแปรของ app.js ที่โหลดทีหลัง จึงอ้างตอนส่งเท่านั้น
  async function sendToDatabase(payload) {
    if (typeof state === "undefined" || typeof sb === "undefined") return;
    if (!state.session?.user || !state.employee) return;
    await sb.rpc("app_log_client_error", {
      p_kind: payload.kind,
      p_message: payload.message,
      p_code: payload.code || null,
      p_page: payload.page || null,
      p_detail: payload.detail || null,
      p_app_version: typeof APP_VERSION === "string" ? APP_VERSION : null,
      p_user_agent: scrub(navigator.userAgent, 300),
      p_is_sandbox: Boolean(state.employee.isSandbox),
    });
  }
  const report = createReporter({ send: sendToDatabase, page: () => pageOf(location.hash) });
  window.addEventListener("error", (event) => report(event.error ?? event.message, { kind: "js" }));
  window.addEventListener("unhandledrejection", (event) => report(event.reason, { kind: "promise" }));
  window.MNP_ERROR_LOG = { ...api, report };
})();
