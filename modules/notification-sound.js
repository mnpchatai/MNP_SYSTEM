// เสียงแจ้งเตือนของบริษัทตอนที่ผู้ใช้เปิดแอปอยู่ — ส่วนตัดสินใจ/จัดการเสียงล้วน ๆ ที่ app.js ใช้
// (ทดสอบด้วย node: scripts/tests/notification-sound.test.mjs) ส่วนที่แตะ DOM/Supabase/service worker อยู่ใน app.js
//
// ไฟล์เสียงเดียวใช้ทุกคน วางที่ sounds/notify.mp3 (ยังไม่มีไฟล์ = ฟีเจอร์เงียบทั้งหมด ไม่มี error และไม่ซ่อนเสียงของระบบปฏิบัติการ)
// เสียงตอนปิดแอป/พับจอเป็นของระบบปฏิบัติการ เปลี่ยนไม่ได้ ที่นี่ดูแลเฉพาะตอนเปิดหน้าเว็บไว้
(function () {
  const SOUND_PATH = "./sounds/notify.mp3";
  const SOUND_SETTING_KEY = "mnp-notify-sound";
  const SOUND_CHANNEL_NAME = "mnp-notify-sound";
  // กันเสียงซ้ำ: เหตุการณ์เดียวกันที่รู้ได้ทั้งจาก push และจากการถามฐานข้อมูล ต้องดังครั้งเดียว
  const SOUND_MIN_GAP_MS = 3000;
  const SOUND_POLL_MS = 60 * 1000;

  // ค่าเริ่มต้น = เปิด · ปิดก็ต่อเมื่อผู้ใช้เลือกปิดเอง ("off") ค่าเสีย/ว่างถือว่าเปิด
  function parseSoundEnabled(stored) {
    return stored !== "off";
  }

  // เครื่องนี้ "รับเสียงได้" เมื่อ: ผู้ใช้ไม่ได้ปิด + ไฟล์เสียงโหลดได้จริง + เบราว์เซอร์อนุญาตให้เล่นแล้ว (เคยมีการกดหน้าจอ)
  function canHandleSound({ enabled = true, ready = false, unlocked = false } = {}) {
    return Boolean(enabled && ready && unlocked);
  }

  // เล่นได้ทันทีหรือไม่: รับเสียงได้ และไม่เพิ่งดังไปไม่ถึง minGapMs ที่แล้ว
  function canPlayNow({ enabled, ready, unlocked, lastPlayedAt = 0, now = Date.now(), minGapMs = SOUND_MIN_GAP_MS } = {}) {
    return canHandleSound({ enabled, ready, unlocked }) && now - lastPlayedAt >= minGapMs;
  }

  // ตัวเลขยังไม่อ่านเปลี่ยน → ต้องเล่นเสียงไหม และค่าอ้างอิงใหม่ที่ต้องจำ
  //   previous เป็น null/undefined = ยังไม่เคยรู้ค่า (โหลดหน้าครั้งแรก/เปลี่ยนบัญชี) → จำค่าอย่างเดียว ไม่เล่น
  //   เพิ่มขึ้นเท่านั้นที่เล่น · เท่าเดิม/ลดลง (อ่านแล้ว) ไม่เล่น · ค่าที่ไม่ใช่ตัวเลข (โหลดไม่สำเร็จ) ไม่เปลี่ยนค่าอ้างอิง
  function unreadChangeDecision({ previous, next, ...gate }) {
    if (typeof next !== "number" || !Number.isFinite(next)) return { play: false, baseline: previous ?? null };
    const increased = typeof previous === "number" && next > previous;
    return { play: increased && canPlayNow(gate), baseline: next };
  }

  // ตัวจัดการเสียงของหน้านี้ — ส่ง dependency เข้ามาเพื่อทดสอบได้โดยไม่ต้องมีเบราว์เซอร์
  //   fetchFile(url) → Promise<Response> ใช้ตรวจว่ามีไฟล์จริง · createAudio(url) → Audio · storage = localStorage (อาจ throw/เป็น null)
  //   channel = BroadcastChannel (หรือ null) ใช้บอกแท็บอื่นว่าเพิ่งดังไปแล้ว จะได้ไม่ดังซ้ำ
  function createNotificationSound({ url = SOUND_PATH, fetchFile, createAudio, storage = null, channel = null, now = Date.now, minGapMs = SOUND_MIN_GAP_MS } = {}) {
    let audio = null;
    let ready = false;
    let unlocked = false;
    let lastPlayedAt = 0;
    let probing = null;
    let memoryEnabled = true;
    // ค่าอ้างอิงตัวเลขยังไม่อ่าน แยกตามบัญชี (owner) เพื่อให้สลับบัญชีแล้วนับใหม่ ไม่เล่นเสียงจากส่วนต่างของคนละคน
    let baseline = { owner: null, count: null };

    const isEnabled = () => {
      try {
        const stored = storage?.getItem(SOUND_SETTING_KEY);
        if (stored !== undefined) return parseSoundEnabled(stored);
      } catch {
        // อ่านไม่ได้ (โหมดส่วนตัว) → ใช้ค่าที่จำไว้ในหน้านี้
      }
      return memoryEnabled;
    };
    const setEnabled = (value) => {
      memoryEnabled = Boolean(value);
      try {
        storage?.setItem(SOUND_SETTING_KEY, memoryEnabled ? "on" : "off");
      } catch {
        // เก็บไม่ได้ก็ใช้ได้ตลอดการเปิดหน้านี้
      }
    };
    const gate = () => ({ enabled: isEnabled(), ready, unlocked, lastPlayedAt, now: now(), minGapMs });

    // ตรวจว่ามีไฟล์เสียงจริง (404 หรือเว็บตอบเป็นหน้า HTML แทน = ไม่มี) ผ่านแล้วถึงถือว่า "พร้อม" · ล้มไม่จำผล เรียกใหม่ได้
    const probe = () => {
      if (ready) return Promise.resolve(true);
      probing ??= (async () => {
        try {
          const response = await fetchFile(url);
          const type = response.headers?.get?.("content-type") ?? "";
          if (!response.ok || /html|^text\//i.test(type)) return false;
          // อ่านจนจบเพื่อให้ไฟล์เข้า cache ของเบราว์เซอร์ ตอนเล่นจะได้ไม่ต้องรอโหลด
          await response.arrayBuffer?.();
          audio = createAudio(url);
          audio.preload = "auto";
          ready = true;
          return true;
        } catch {
          return false;
        } finally {
          probing = null;
        }
      })();
      return probing;
    };

    // เบราว์เซอร์บล็อกเสียงจนกว่าผู้ใช้จะกดหน้าจอ: ลองเล่นแบบปิดเสียงเพื่อดูว่าปลดล็อกแล้วหรือยัง ล้มก็ลองใหม่ตอนกดครั้งถัดไป
    async function unlock() {
      if (unlocked) return true;
      if (!(await probe())) return false;
      try {
        audio.muted = true;
        await audio.play();
        audio.pause();
        audio.currentTime = 0;
        unlocked = true;
      } catch {
        // ยังถูกบล็อก
      } finally {
        audio.muted = false;
      }
      return unlocked;
    }

    // คืน "played" | "skipped" (ไม่ถึงเวลา/ปิดเสียง/ไฟล์ไม่พร้อม) | "failed" (เบราว์เซอร์ไม่ยอมเล่น)
    // preview = ปุ่ม "ลองฟังเสียง": เล่นเสมอแม้ปิดเสียงอยู่ · audio.play() ต้องถูกเรียกก่อน await ใด ๆ เพื่อให้ยังนับเป็นจังหวะที่ผู้ใช้กด (iOS)
    async function play({ preview = false } = {}) {
      if (!ready || !audio) return "skipped";
      if (!preview && !canPlayNow(gate())) return "skipped";
      const previousPlayedAt = lastPlayedAt;
      lastPlayedAt = now(); // จองก่อนเล่น กันสองทางเรียกพร้อมกันแล้วดังซ้อน
      try {
        audio.muted = false;
        audio.currentTime = 0;
        const started = audio.play();
        await started;
        unlocked = true;
        if (!preview) channel?.postMessage({ type: "played", at: lastPlayedAt, owner: baseline.owner, count: baseline.count });
        return "played";
      } catch {
        lastPlayedAt = previousPlayedAt;
        return "failed";
      }
    }

    // รับค่าตัวเลขยังไม่อ่านล่าสุดของบัญชี owner · announce=false จำค่าอย่างเดียว ไม่เล่นเสียง · คืน true ถ้าสั่งเล่นเสียงแล้ว
    function observeUnread(owner, count, { announce = true } = {}) {
      const previous = baseline.owner === owner ? baseline.count : null;
      const decision = unreadChangeDecision({ previous, next: count, ...gate() });
      baseline = { owner, count: decision.baseline };
      if (!announce || !decision.play) return false;
      play();
      return true;
    }

    // ผู้ใช้อ่านแล้วเอง (ตัวเลขลด) — ตั้งค่าอ้างอิงทันที ไม่งั้นแจ้งเตือนใหม่ที่เข้ามาพร้อมกันจะถูกกลืน
    function setBaseline(owner, count) {
      baseline = { owner, count: Number.isFinite(count) ? count : null };
    }

    // แท็บอื่นเพิ่งเล่นเสียงแล้ว: จำเวลาไว้กันดังซ้ำ และยกค่าอ้างอิงตามให้ถ้าเป็นบัญชีเดียวกัน
    if (channel) {
      channel.onmessage = (event) => {
        const message = event?.data;
        if (message?.type !== "played" || !Number.isFinite(message.at)) return;
        lastPlayedAt = Math.max(lastPlayedAt, now());
        if (message.owner && message.owner === baseline.owner && Number.isFinite(message.count)) baseline.count = message.count;
      };
    }

    return {
      probe,
      unlock,
      play,
      observeUnread,
      setBaseline,
      isEnabled,
      setEnabled,
      isReady: () => ready,
      isUnlocked: () => unlocked,
      // รับเสียงได้จริงตอนนี้ (ใช้ตอบ service worker ว่า "เดี๋ยวฉันเล่นเสียงเอง ไม่ต้องให้ระบบเล่นซ้อน")
      canHandle: () => canHandleSound(gate()),
      // เปิดไว้และไฟล์พร้อม (ยังไม่จำเป็นต้องปลดล็อก) — ใช้ตัดสินว่าควรถามฐานข้อมูลเป็นระยะหรือไม่
      isActive: () => ready && isEnabled(),
    };
  }

  const api = { SOUND_PATH, SOUND_SETTING_KEY, SOUND_CHANNEL_NAME, SOUND_MIN_GAP_MS, SOUND_POLL_MS, parseSoundEnabled, canHandleSound, canPlayNow, unreadChangeDecision, createNotificationSound };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.MNP_NOTIFY_SOUND = api;
})();
