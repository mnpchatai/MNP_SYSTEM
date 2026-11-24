// ทะเบียนอุปกรณ์ IT (itas) — ตู้เซฟเข้ารหัสช่องลับในเบราว์เซอร์ (Web Crypto) · ไม่มี DOM · เทสต์ที่ scripts/tests/itas-vault.test.mjs
// สัญญา: docs/itas-contract.md หัวข้อ "ช่องลับและตู้เซฟ" (ขั้นตอนและกฎความปลอดภัยฝั่งหน้าเว็บทุกข้อทำตามไฟล์นั้น)
//
// หลักการ:
//  - ฐานข้อมูลไม่เคยเห็นรหัสตู้เซฟ รหัสกู้คืน กุญแจหลัก (DEK) หรือค่าลับ · ส่งขึ้นไปแค่ ciphertext กับ "auth token" ที่ derive จาก DEK (ใช้พิสูจน์ตอนเปลี่ยนรหัส)
//  - DEK เป็น CryptoKey แบบ non-extractable เสมอ อยู่ในตัวแปรปิดของไฟล์นี้เท่านั้น (ไม่ผูก window ไม่ลง localStorage/sessionStorage/IndexedDB)
//    raw ของ DEK มีแค่ชั่วคราวตอนตั้งครั้งแรกและตอนห่อใหม่ แล้ว fill(0) ทันที
//  - ล็อก = ทิ้ง CryptoKey ทั้งหมด + ล้างรหัสที่ค้างระหว่างตั้ง (ล็อกเองเมื่อไม่ใช้งาน 10 นาที / เปลี่ยนบริบท (ผู้ใช้ โหมดทดสอบ persona) / module เรียก lock())
//  - ไม่ใช้งาน 10 นาที: นับจากนาฬิกาจริง (Date.now ของกิจกรรมล่าสุด) ไม่พึ่ง setTimeout ก้อนเดียว · มีตัวตรวจเป็นระยะ และ checkIdle() ให้ module เรียกเมื่อกลับมาที่แท็บ
//  - ทุกงาน async ที่ตั้งกุญแจ/สถานะหลัง await (ปลดล็อก ตั้งครั้งแรก เตรียมรหัส) เทียบ "รุ่นของการล็อก" (generation) ก่อนตั้ง · ถ้ามี lock() คั่นกลางทิ้งผลและโยน INTERRUPTED
//  - ข้อความ error ของไฟล์นี้เป็นข้อความคงที่ทั้งหมด ไม่ต่อด้วยค่าที่ผู้ใช้กรอกหรือถอดได้ (modules/client-error-log.js ส่งข้อความ error ขึ้นฐานข้อมูล)
//  - ไม่ใช้ Math.random · ตัวเลขสุ่มทั้งหมดมาจาก crypto.getRandomValues
(function (root) {
  "use strict";

  const KDF = "PBKDF2-SHA256";
  const MIN_ITERATIONS = 600000; // ต่ำกว่านี้ = ปฏิเสธ (กันข้อมูลตู้เซฟที่ถูกแก้ให้เดารหัสง่าย)
  const MAX_ITERATIONS = 10000000;
  const DEFAULT_ITERATIONS = 1000000;
  const SALT_BYTES = 16;
  const NONCE_BYTES = 12;
  const DEK_BYTES = 32;
  const WRAPPED_BYTES = DEK_BYTES + 16; // DEK + GCM tag
  const MIN_CIPHER_BYTES = 17;
  const MAX_CIPHER_BYTES = 4096;
  const MAX_PLAIN_BYTES = 4080;
  const AUTH_INFO = "itas-vault-auth-v1";
  const MIN_PASSWORD_LENGTH = 14;
  const MIN_DISTINCT_CHARS = 6; // รหัสตู้เซฟต้องมีตัวอักษรไม่ซ้ำกันอย่างน้อยกี่แบบ
  const IDLE_MS = 10 * 60 * 1000;
  const IDLE_CHECK_MS = 30 * 1000; // ตรวจเวลาไม่ใช้งานทุกกี่มิลลิวินาที (ตัวตรวจอีกทางคือ checkIdle() ตอนกลับมาที่แท็บ)
  // รหัสกู้คืน: 32 ตัว × 5 บิต = 160 บิต · ตัวอักษรแบบ Crockford base32 (ไม่มี I L O U ไม่สับสนกับ 1 0) · 256 หารด้วย 32 ลงตัว จึงไม่มีความเอนเอียงตอนสุ่ม
  const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const RECOVERY_LENGTH = 32;
  const RECOVERY_GROUP = 4;

  const MESSAGES = Object.freeze({
    UNSUPPORTED: "เบราว์เซอร์นี้ไม่รองรับการเข้ารหัสที่ตู้เซฟต้องใช้ (ต้องเปิดผ่าน https และเป็นรุ่นใหม่)",
    CORRUPT: "ตู้เซฟผิดปกติ ไม่สามารถใช้งานได้ กรุณาแจ้งผู้ดูแลระบบ",
    WRONG_SECRET: "รหัสไม่ถูกต้อง",
    LOCKED: "ตู้เซฟถูกล็อกอยู่ กรุณาปลดล็อกก่อน",
    NOT_LOADED: "ยังไม่ได้โหลดสถานะตู้เซฟ",
    NOT_INITIALIZED: "ตู้เซฟยังไม่ได้ตั้งค่า",
    ALREADY_INITIALIZED: "ตู้เซฟถูกตั้งค่าไปแล้ว ตั้งซ้ำไม่ได้",
    WEAK_PASSWORD: `รหัสตู้เซฟต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`,
    WEAK_FEW_DISTINCT: `รหัสตู้เซฟใช้ตัวอักษรซ้ำกันมากเกินไป (ต้องมีตัวอักษรไม่ซ้ำกันอย่างน้อย ${MIN_DISTINCT_CHARS} แบบ)`,
    WEAK_PATTERN: "รหัสตู้เซฟเป็นตัวอักษรเรียงกันหรือซ้ำเป็นแพทเทิร์นที่เดาง่าย กรุณาใช้วลีหลายคำที่เดายาก",
    WEAK_FORBIDDEN: "รหัสตู้เซฟห้ามเป็นรหัสพนักงานหรือชื่อผู้ใช้ของคุณ",
    INTERRUPTED: "ตู้เซฟถูกล็อกระหว่างดำเนินการ ไม่ได้ปลดล็อกให้ กรุณาลองใหม่",
    SETUP_LOCKED: "ตั้งตู้เซฟเรียบร้อยแล้ว แต่ตู้เซฟถูกล็อกระหว่างดำเนินการ กรุณาปลดล็อกด้วยรหัสตู้เซฟที่เพิ่งตั้ง",
    ROTATE_VERIFY_FAILED: "ส่งการเปลี่ยนแปลงขึ้นระบบแล้ว แต่ตรวจสอบชุดรหัสใหม่ไม่ผ่าน ห้ามทิ้งรหัสเดิม และกรุณาแจ้งผู้ดูแลระบบให้กู้ตู้เซฟจากประวัติก่อนใช้งานต่อ",
    CONFIRM_MISMATCH: "รหัสที่พิมพ์ยืนยันไม่ตรงกัน",
    NOTHING_PENDING: "ไม่มีขั้นตอนที่รอยืนยันอยู่ กรุณาเริ่มใหม่",
    DECRYPT_FAILED: "ถอดรหัสไม่ได้",
    ENCRYPT_FAILED: "เข้ารหัสไม่ได้",
    VALUE_TOO_LONG: "ค่าลับยาวเกินกำหนด",
    AUTH_TOKEN_INVALID: "ยืนยันกุญแจของตู้เซฟไม่ผ่าน จึงไม่ได้เปลี่ยนอะไร กรุณาปลดล็อกตู้เซฟด้วยรหัสที่ถูกต้องแล้วลองใหม่",
    VERIFY_FAILED: "ตั้งตู้เซฟแล้วแต่ตรวจสอบหลังตั้งไม่ผ่าน กรุณาแจ้งผู้ดูแลระบบก่อนใช้งาน",
    BAD_ENVELOPE: "รูปแบบข้อมูลลับไม่ถูกต้อง",
    GENERIC: "ตู้เซฟทำงานไม่สำเร็จ กรุณาลองใหม่",
  });

  class VaultError extends Error {
    constructor(reason) {
      super(MESSAGES[reason] ?? MESSAGES.GENERIC);
      this.name = "VaultError";
      this.reason = reason;
      this.code = `ITAS_VAULT_${reason}`;
    }
  }

  /* ---------- base64 มาตรฐาน (มี padding) ---------- */
  const utf8 = (text) => new TextEncoder().encode(String(text));
  function toBase64(bytes) {
    let text = "";
    for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(text);
  }
  const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  // ถอด base64 ที่ต้องเป็นมาตรฐานมี padding และเป็นรูปบัญญัติ (เข้ารหัสกลับแล้วต้องได้ข้อความเดิม) · ความยาวไบต์ผิด = null
  function fromBase64(text, { length = null, min = null, max = null } = {}) {
    if (typeof text !== "string" || !BASE64.test(text)) return null;
    let bytes;
    try {
      const binary = atob(text);
      bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    } catch {
      return null;
    }
    if (toBase64(bytes) !== text) return null;
    if (length !== null && bytes.length !== length) return null;
    if (min !== null && bytes.length < min) return null;
    if (max !== null && bytes.length > max) return null;
    return bytes;
  }

  /* ---------- รหัสกู้คืน ---------- */
  // ข้อความที่แสดงให้จด: 8 กลุ่ม กลุ่มละ 4 ตัว คั่นด้วย -
  const formatRecoveryCode = (canonical) => String(canonical).match(new RegExp(`.{1,${RECOVERY_GROUP}}`, "g"))?.join("-") ?? "";
  // รับที่ผู้ใช้พิมพ์: ตัวพิมพ์เล็กได้ เว้นวรรค/ขีดได้ O→0 และ I/L→1 (ตัวที่หน้าตาคล้ายกัน)
  function normalizeRecoveryCode(text) {
    return String(text ?? "").normalize("NFKC").toUpperCase().replace(/[\s\-–—_]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  }
  const isRecoveryFormat = (canonical) => canonical.length === RECOVERY_LENGTH && [...canonical].every((char) => RECOVERY_ALPHABET.includes(char));

  /* ---------- กฎรหัสตู้เซฟ (บล็อกจริง ไม่ใช่แค่เตือน) ---------- */
  // ฐานข้อมูลกันเดารหัสแทนไม่ได้ (ข้อมูลที่ถูกขโมยไปเดารหัสออฟไลน์ได้) จึงบล็อกรหัสที่เดาง่าย: สั้น · ตัวอักษรไม่ซ้ำน้อยกว่า 6 · เรียง/ซ้ำชัดเจน · เท่ากับรหัสพนักงาน/username
  const PATTERN_RUNS = ["qwertyuiopasdfghjklzxcvbnm", "abcdefghijklmnopqrstuvwxyz", "01234567890123456789"];
  const reverseText = (text) => Array.from(text).reverse().join("");
  function isObviousPattern(compact) {
    if (!compact.length) return true;
    // ทุกคู่ติดกันห่างกันไม่เกิน 1 (aaaa… abcd… 4321… ก ข ค ง…)
    if (compact.every((char, index) => index === 0 || Math.abs(char.codePointAt(0) - compact[index - 1].codePointAt(0)) <= 1)) return true;
    // ซ้ำหน่วยสั้น ๆ (abab… 1212… abc123abc123…) ไม่เกิน 4 ตัว
    for (let unit = 1; unit <= 4; unit += 1) if (compact.every((char, index) => char === compact[index % unit])) return true;
    // แถวคีย์บอร์ด / ตัวอักษร / ตัวเลขเรียงต่อกัน (ทั้งไปและกลับ)
    const joined = compact.join("");
    return PATTERN_RUNS.some((run) => run.includes(joined) || reverseText(run).includes(joined));
  }
  // คืนรหัสเหตุผล (คีย์ใน MESSAGES) หรือ null ถ้าผ่าน · forbidden = ค่าที่ห้ามใช้ (รหัสพนักงาน username ของผู้ใช้ที่ล็อกอิน)
  function passwordProblem(password, forbidden = []) {
    const text = String(password ?? "").normalize("NFKC");
    const chars = Array.from(text);
    if (chars.length < MIN_PASSWORD_LENGTH) return "WEAK_PASSWORD";
    const lower = text.toLowerCase();
    if (new Set(Array.from(lower)).size < MIN_DISTINCT_CHARS) return "WEAK_FEW_DISTINCT";
    if (isObviousPattern(Array.from(lower.replace(/\s+/g, "")))) return "WEAK_PATTERN";
    for (const item of forbidden ?? []) {
      const value = String(item ?? "").normalize("NFKC").trim().toLowerCase();
      if (!value) continue;
      // เท่ากับค่านั้นเป๊ะ หรือเหลือแต่ค่านั้นซ้ำ ๆ (เหลือตัวอื่นไม่เกิน 2 ตัวหลังตัดทิ้ง)
      if (lower === value || (value.length >= 3 && Array.from(lower.split(value).join("").replace(/\s+/g, "")).length <= 2)) return "WEAK_FORBIDDEN";
    }
    return null;
  }

  // UUID v4: ใช้ randomUUID ถ้ามี ไม่มี (เบราว์เซอร์เก่า) สร้างเองจาก getRandomValues
  function newUuid(cryptoObject = root.crypto) {
    if (typeof cryptoObject?.randomUUID === "function") return cryptoObject.randomUUID();
    if (typeof cryptoObject?.getRandomValues !== "function") throw new VaultError("UNSUPPORTED");
    const bytes = new Uint8Array(16);
    cryptoObject.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    bytes.fill(0);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /* ---------- ตรวจข้อมูลตู้เซฟจากเซิร์ฟเวอร์ก่อนใช้ ---------- */
  function validWrapped(value) {
    if (!value || typeof value !== "object") return null;
    const n = fromBase64(value.n, { length: NONCE_BYTES });
    const c = fromBase64(value.c, { length: WRAPPED_BYTES });
    return n && c ? { n, c } : null;
  }
  const validIterations = (value) => Number.isInteger(value) && value >= MIN_ITERATIONS && value <= MAX_ITERATIONS;
  // data = ผลของ app_itas_vault_get · คืน { initialized:false, isTest } หรือข้อมูลที่ถอด base64 แล้ว · ผิดข้อใด = ตู้เซฟผิดปกติ (ห้าม derive)
  function parseVaultState(data) {
    if (!data || typeof data !== "object" || typeof data.initialized !== "boolean") throw new VaultError("CORRUPT");
    const isTest = data.is_test === true;
    if (!data.initialized) return { initialized: false, isTest };
    const salt = fromBase64(data.salt, { length: SALT_BYTES });
    const recoverySalt = fromBase64(data.recovery_salt, { length: SALT_BYTES });
    const pass = validWrapped(data.wrapped_key_pass);
    const recovery = validWrapped(data.wrapped_key_recovery);
    if (data.kdf !== KDF || !validIterations(data.kdf_iterations) || !validIterations(data.recovery_kdf_iterations)) throw new VaultError("CORRUPT");
    if (!salt || !recoverySalt || !pass || !recovery) throw new VaultError("CORRUPT");
    if (!Number.isInteger(data.key_version) || data.key_version < 1 || !Number.isInteger(data.rev) || data.rev < 1) throw new VaultError("CORRUPT");
    return {
      initialized: true, isTest, keyVersion: data.key_version, rev: data.rev,
      pass: { iterations: data.kdf_iterations, salt, wrapped: pass },
      recovery: { iterations: data.recovery_kdf_iterations, salt: recoverySalt, wrapped: recovery },
    };
  }

  // ซองข้อมูลลับ { v:1, n, c } ต้องมีสามคีย์นี้เท่านั้น
  function validEnvelope(envelope) {
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
    const keys = Object.keys(envelope).sort().join(",");
    if (keys !== "c,n,v" || envelope.v !== 1) return null;
    const n = fromBase64(envelope.n, { length: NONCE_BYTES });
    const c = fromBase64(envelope.c, { min: MIN_CIPHER_BYTES, max: MAX_CIPHER_BYTES });
    return n && c ? { n, c } : null;
  }

  /* ---------- HKDF / SHA-256 ที่ตรงกับฐานข้อมูล (ใช้กับ test vector ในสัญญา) ---------- */
  // raw = DEK ดิบ 32 ไบต์ (เรียกจากเทสต์เท่านั้น โค้ดจริงใช้ CryptoKey) · คืน token กับ authHash เป็น base64
  async function authMaterialFromRaw(subtle, raw) {
    const key = await subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]);
    const token = new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(AUTH_INFO) }, key, 256));
    const hash = new Uint8Array(await subtle.digest("SHA-256", token));
    return { token: toBase64(token), authHash: toBase64(hash) };
  }

  /* ---------- ตัวตู้เซฟ ---------- */
  // server = { get(), init(params), rotate(params) } ส่งเป็นฟังก์ชันที่เรียก RPC (ผลของ RPC คืน data หรือ throw error)
  // getContext() = ข้อความระบุ "ใคร/โหมดไหน" ตอนนี้ (ผู้ใช้ + โหมดทดสอบ + persona) เปลี่ยนเมื่อไรตู้เซฟล็อกเอง
  function createVault({
    subtle = root.crypto?.subtle, getRandomValues = (bytes) => root.crypto.getRandomValues(bytes), server, getContext = () => "",
    iterations = DEFAULT_ITERATIONS, idleMs = IDLE_MS, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
    now = () => Date.now(), getForbidden = () => [],
  } = {}) {
    if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new VaultError("CORRUPT");
    // ตัวแปรปิดทั้งหมด: ไม่มีทางอ่านออกจากภายนอก
    let info = null; // ผลล่าสุดของ parseVaultState (ไม่มีความลับ)
    let keys = null; // { aes, hkdf, keyVersion, isTest, context } เมื่อปลดล็อก
    let pending = null; // ขั้นตอนที่รอผู้ใช้ยืนยันรหัสกู้คืน (ตั้งครั้งแรก / ออกรหัสกู้คืนใหม่)
    let timer = null;
    let lastActive = 0; // Date.now() ของกิจกรรมล่าสุดขณะปลดล็อก (เวลาไม่ใช้งานตัดสินจากค่านี้ ไม่ใช่จาก setTimeout)
    let generation = 0; // เพิ่มทุกครั้งที่ lock() · งาน async ที่เริ่มก่อนล็อกแล้วเสร็จหลังล็อกต้องไม่ตั้งกุญแจ/สถานะ
    const checkMs = Math.min(IDLE_CHECK_MS, idleMs);
    const listeners = new Set();

    const ensureCrypto = () => { if (!subtle || typeof subtle.deriveKey !== "function") throw new VaultError("UNSUPPORTED"); };
    const randomBytes = (length) => {
      const bytes = new Uint8Array(length);
      getRandomValues(bytes);
      return bytes;
    };
    const aadForWrap = (isTest, kind, keyVersion) => utf8(`itas-vault|${isTest ? "test" : "real"}|${kind}|${keyVersion}`);

    function status() {
      if (keys) return "unlocked";
      if (!info) return "unknown";
      return info.initialized ? "locked" : "uninitialized";
    }
    const snapshot = () => ({ status: status(), isTest: info?.isTest ?? null, hasPending: Boolean(pending) });
    const emit = (reason = "") => { for (const listener of [...listeners]) { try { listener({ ...snapshot(), reason }); } catch { /* ตัวฟังพังต้องไม่ขวางการล็อก */ } } };
    function stopTimer() { if (timer !== null) { clearTimer(timer); timer = null; } }
    // ตัวตรวจเวลาไม่ใช้งานเป็นระยะ (ตั้งต่อกันทีละครั้ง) · ตัวตัดสินจริงคือ checkIdle() ที่เทียบนาฬิกา
    // ถ้าเบราว์เซอร์หน่วงตัวจับเวลาตอนแท็บถูกซ่อน/เครื่องหลับ การเรียก checkIdle() ครั้งถัดไป (เช่นตอนกลับมาที่แท็บ) ก็ยังล็อกถูกต้อง
    function armTimer() {
      if (timer !== null || !keys) return;
      timer = setTimer(() => { timer = null; checkIdle(); if (keys) armTimer(); }, checkMs);
    }
    // ไม่ใช้งานเกินกำหนด (หรือนาฬิกาถอยหลัง = ผิดปกติ) = ล็อกทันที · คืน true ถ้าล็อกแล้ว
    function checkIdle() {
      if (!keys) return false;
      const elapsed = now() - lastActive;
      if (elapsed >= idleMs || elapsed < 0) { lock("idle"); return true; }
      return false;
    }
    function markActive() { lastActive = now(); armTimer(); }
    function lock(reason = "manual") {
      const changed = Boolean(keys || pending);
      generation += 1; // งานที่ค้างอยู่ระหว่าง await ต้องทิ้งผลของตัวเอง
      keys = null;
      pending = null; // ทิ้งรหัสและกุญแจที่ค้างระหว่างตั้ง
      stopTimer();
      if (changed || reason === "reset") emit(reason);
    }
    // มีการใช้งาน: เริ่มนับเวลาไม่ใช้งานใหม่ (ถ้าเกินกำหนดไปแล้ว ล็อกแทนที่จะต่อเวลาให้)
    function touch() { if (keys && !checkIdle()) markActive(); }
    // ถ้าบริบทเปลี่ยนไปจากตอนปลดล็อก (สลับผู้ใช้ เข้า/ออกโหมดทดสอบ สลับ persona) หรือไม่ใช้งานเกินกำหนด ล็อกทันที
    function ensureContext() {
      checkIdle();
      if (keys && keys.context !== getContext()) lock("context");
      if (pending && pending.context !== getContext()) lock("context");
    }
    // งานที่เริ่มเมื่อรุ่น gen และบริบท context: ถ้ามีการล็อก/เปลี่ยนบริบทคั่นกลางระหว่าง await = ถูกขัดจังหวะ (ผู้เรียกทิ้งผลและโยน error)
    const interrupted = (gen, context) => gen !== generation || context !== getContext();

    async function deriveKek(secret, salt, rounds) {
      ensureCrypto();
      const bytes = utf8(String(secret).normalize("NFKC"));
      try {
        const material = await subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveKey"]);
        return await subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]);
      } catch {
        throw new VaultError("UNSUPPORTED");
      } finally {
        bytes.fill(0);
      }
    }
    async function wrapRaw(kek, raw, aad) {
      const nonce = randomBytes(NONCE_BYTES);
      let cipher;
      try {
        cipher = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, kek, raw));
      } catch {
        throw new VaultError("ENCRYPT_FAILED");
      }
      return { n: toBase64(nonce), c: toBase64(cipher) };
    }
    // ถอดห่อเป็น CryptoKey non-extractable โดยไม่เห็น raw (ทางที่ 1) · ถ้าเบราว์เซอร์ทำไม่ได้ใช้ทางที่ 2 (decrypt แล้ว import แล้ว fill(0))
    async function openKeys(kek, wrapped, aad) {
      const params = { name: "AES-GCM", iv: wrapped.n, additionalData: aad, tagLength: 128 };
      try {
        const aes = await subtle.unwrapKey("raw", wrapped.c, kek, params, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
        const hkdf = await subtle.unwrapKey("raw", wrapped.c, kek, params, { name: "HKDF" }, false, ["deriveBits"]);
        return { aes, hkdf };
      } catch {
        // ไปทางที่ 2
      }
      const raw = await openRaw(kek, wrapped, aad);
      try {
        return {
          aes: await subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]),
          hkdf: await subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]),
        };
      } catch {
        throw new VaultError("UNSUPPORTED");
      } finally {
        raw.fill(0);
      }
    }
    // DEK ดิบชั่วคราว (ผู้เรียกต้อง fill(0) เอง) · ผิดรหัส = GCM tag ไม่ผ่าน
    async function openRaw(kek, wrapped, aad) {
      let raw;
      try {
        raw = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: wrapped.n, additionalData: aad, tagLength: 128 }, kek, wrapped.c));
      } catch {
        throw new VaultError("WRONG_SECRET");
      }
      if (raw.length !== DEK_BYTES) { raw.fill(0); throw new VaultError("CORRUPT"); }
      return raw;
    }
    async function tokenOfHkdfKey(hkdfKey) {
      return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(AUTH_INFO) }, hkdfKey, 256));
    }
    const sha256 = async (bytes) => new Uint8Array(await subtle.digest("SHA-256", bytes));

    // อ่านสถานะจากเซิร์ฟเวอร์ (ใหม่ทุกครั้ง) และตรวจพารามิเตอร์ KDF ก่อนใช้
    async function load() {
      ensureCrypto();
      const parsed = parseVaultState(await server.get());
      info = parsed;
      // ตู้เซฟที่เซิร์ฟเวอร์ว่า "ยังไม่ตั้ง" ทั้งที่เครื่องนี้ปลดล็อกอยู่ = ผิดปกติ ล็อกไว้ก่อน
      if (keys && !parsed.initialized) lock("reset");
      return snapshot();
    }
    async function fetchState({ initialized }) {
      const parsed = parseVaultState(await server.get());
      info = parsed;
      if (initialized && !parsed.initialized) throw new VaultError("NOT_INITIALIZED");
      if (!initialized && parsed.initialized) throw new VaultError("ALREADY_INITIALIZED");
      return parsed;
    }

    /* ----- ปลดล็อก ----- */
    // kind: "pass" = รหัสตู้เซฟ · "recovery" = รหัสกู้คืน (ผู้เรียกส่งข้อความที่ผู้ใช้พิมพ์มา)
    // ข้อความที่ผู้ใช้พิมพ์ → ข้อความที่ใช้ derive จริง · รหัสกู้คืนที่รูปแบบผิด (ไม่ใช่ 32 ตัวของตัวอักษรที่กำหนด) ปฏิเสธก่อนเสียเวลา KDF และก่อนเรียกเซิร์ฟเวอร์
    function secretText(kind, secret) {
      const text = kind === "recovery" ? normalizeRecoveryCode(secret) : String(secret ?? "");
      if (!text || (kind === "recovery" && !isRecoveryFormat(text))) throw new VaultError("WRONG_SECRET");
      return text;
    }
    async function unlock(kind, secret) {
      // รุ่นและบริบทตอนเริ่ม: ถ้ามี lock() หรือเปลี่ยนผู้ใช้/โหมดคั่นระหว่างรอ KDF ต้องไม่ตั้งกุญแจ (ไม่งั้นตู้เซฟค้างปลดล็อกหลังออกจากหน้าไปแล้ว)
      const gen = generation;
      const context = getContext();
      const text = secretText(kind, secret);
      const state = await fetchState({ initialized: true });
      const part = kind === "recovery" ? state.recovery : state.pass;
      const kek = await deriveKek(text, part.salt, part.iterations);
      const opened = await openKeys(kek, part.wrapped, aadForWrap(state.isTest, kind === "recovery" ? "recovery" : "pass", state.keyVersion));
      if (interrupted(gen, context)) throw new VaultError("INTERRUPTED"); // ทิ้ง opened (CryptoKey ที่ดึงออกไม่ได้) ปล่อยให้ถูกเก็บกวาด
      keys = { ...opened, keyVersion: state.keyVersion, isTest: state.isTest, context };
      pending = null;
      markActive();
      emit("unlock");
      return snapshot();
    }

    /* ----- ตั้งครั้งแรก (สองจังหวะ: เตรียม → ผู้ใช้จดและพิมพ์รหัสกู้คืนกลับ → ส่งขึ้นเซิร์ฟเวอร์) ----- */
    function checkPassword(password) {
      const problem = passwordProblem(password, getForbidden());
      if (problem) throw new VaultError(problem);
    }
    function newRecoveryCode() {
      const bytes = randomBytes(RECOVERY_LENGTH);
      let code = "";
      for (const byte of bytes) code += RECOVERY_ALPHABET[byte & 31];
      bytes.fill(0);
      return code;
    }
    async function prepareSetup(password) {
      const gen = generation;
      const context = getContext();
      const state = await fetchState({ initialized: false });
      checkPassword(password);
      const raw = randomBytes(DEK_BYTES);
      try {
        const hkdf = await subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]);
        const authHash = toBase64(await sha256(await tokenOfHkdfKey(hkdf)));
        const recoveryCode = newRecoveryCode();
        const salt = randomBytes(SALT_BYTES);
        const recoverySalt = randomBytes(SALT_BYTES);
        const passKek = await deriveKek(password, salt, iterations);
        const recoveryKek = await deriveKek(recoveryCode, recoverySalt, iterations);
        const wrappedPass = await wrapRaw(passKek, raw, aadForWrap(state.isTest, "pass", 1));
        const wrappedRecovery = await wrapRaw(recoveryKek, raw, aadForWrap(state.isTest, "recovery", 1));
        if (interrupted(gen, context)) throw new VaultError("INTERRUPTED"); // ล็อกแล้วระหว่างคำนวณ: ห้ามเก็บรหัสที่เพิ่งสร้างไว้ใน pending
        pending = {
          type: "setup", context, password: String(password), recoveryCode, authHash,
          params: {
            p_kdf: KDF, p_kdf_iterations: iterations, p_salt: toBase64(salt), p_wrapped_key_pass: wrappedPass,
            p_recovery_kdf_iterations: iterations, p_recovery_salt: toBase64(recoverySalt), p_wrapped_key_recovery: wrappedRecovery, p_auth_hash: authHash,
          },
        };
        return { recoveryCode: formatRecoveryCode(recoveryCode) };
      } finally {
        raw.fill(0);
      }
    }
    function requirePending(type) {
      ensureContext();
      if (!pending || pending.type !== type) throw new VaultError("NOTHING_PENDING");
      return pending;
    }
    // typed = รหัสกู้คืนที่ผู้ใช้พิมพ์กลับเข้ามา (ยืนยันว่าจดแล้ว) · ผ่านแล้วค่อยส่งขึ้นเซิร์ฟเวอร์ แล้วตรวจตัวเอง: ปลดล็อกได้ด้วยรหัสตู้เซฟ + รหัสกู้คืนจริง และ auth token ตรงกับที่ส่งไป
    async function commitSetup(typed) {
      const gen = generation;
      const current = requirePending("setup");
      if (normalizeRecoveryCode(typed) !== current.recoveryCode) throw new VaultError("CONFIRM_MISMATCH");
      await server.init(current.params);
      const { password, recoveryCode, authHash } = current;
      pending = null; // รหัสไม่ต้องค้างต่อหลังส่งแล้ว
      try {
        const state = await fetchState({ initialized: true });
        const viaRecovery = await openKeys(await deriveKek(recoveryCode, state.recovery.salt, state.recovery.iterations), state.recovery.wrapped, aadForWrap(state.isTest, "recovery", state.keyVersion));
        const viaPass = await openKeys(await deriveKek(password, state.pass.salt, state.pass.iterations), state.pass.wrapped, aadForWrap(state.isTest, "pass", state.keyVersion));
        const hashPass = toBase64(await sha256(await tokenOfHkdfKey(viaPass.hkdf)));
        const hashRecovery = toBase64(await sha256(await tokenOfHkdfKey(viaRecovery.hkdf)));
        if (hashPass !== authHash || hashRecovery !== authHash) throw new VaultError("VERIFY_FAILED");
        // ตั้งขึ้นเซิร์ฟเวอร์สำเร็จและตรวจผ่านแล้ว แต่ถ้าถูกล็อกระหว่างนี้ ห้ามปลดล็อกให้เอง (ผู้ใช้ปลดล็อกด้วยรหัสที่เพิ่งตั้ง)
        if (interrupted(gen, current.context)) throw new VaultError("SETUP_LOCKED");
        keys = { ...viaPass, keyVersion: state.keyVersion, isTest: state.isTest, context: current.context };
        markActive();
        emit("setup");
        return snapshot();
      } catch (error) {
        if (error instanceof VaultError && (error.reason === "VERIFY_FAILED" || error.reason === "SETUP_LOCKED")) throw error;
        throw new VaultError("VERIFY_FAILED");
      }
    }
    function cancelPending() { pending = null; }

    /* ----- เปลี่ยนรหัสตู้เซฟ / ออกรหัสกู้คืนใหม่ ----- */
    // ต้องพิสูจน์ตัวใหม่ทุกครั้งด้วยรหัสตู้เซฟหรือรหัสกู้คืน (ไม่ใช้ DEK ที่ค้างอยู่) · ไม่แตะแถวข้อมูล ไม่เปลี่ยน DEK
    async function reauthenticate(kind, secret) {
      const text = secretText(kind, secret);
      const state = await fetchState({ initialized: true });
      const part = kind === "recovery" ? state.recovery : state.pass;
      const kek = await deriveKek(text, part.salt, part.iterations);
      const raw = await openRaw(kek, part.wrapped, aadForWrap(state.isTest, kind === "recovery" ? "recovery" : "pass", state.keyVersion));
      return { state, raw };
    }
    async function callRotate(params) {
      const result = await server.rotate(params);
      if (!result || result.ok !== true) {
        if (result?.code === "AUTH_TOKEN_INVALID") throw new VaultError("AUTH_TOKEN_INVALID");
        throw new VaultError("GENERIC");
      }
      if (info?.initialized && Number.isInteger(result.rev)) info = { ...info, rev: result.rev };
      return result;
    }
    // เปลี่ยนรหัสตู้เซฟ · kind/secret = รหัสปัจจุบัน (รหัสตู้เซฟ หรือรหัสกู้คืนกรณีลืมรหัส)
    async function changePassword({ kind, secret, newPassword }) {
      const gen = generation;
      const context = getContext();
      checkPassword(newPassword);
      const { state, raw } = await reauthenticate(kind, secret);
      let token;
      try {
        token = toBase64(await rawToken(raw));
        const salt = randomBytes(SALT_BYTES);
        const kek = await deriveKek(newPassword, salt, iterations);
        const wrapped = await wrapRaw(kek, raw, aadForWrap(state.isTest, "pass", state.keyVersion));
        if (interrupted(gen, context)) throw new VaultError("INTERRUPTED"); // ผู้ใช้ออกจากหน้า/ถูกล็อกระหว่างคำนวณ: ยังไม่ส่งอะไรขึ้นเซิร์ฟเวอร์
        await callRotate({
          p_expected_rev: state.rev, p_action: "change_password", p_auth_token: token,
          p_kdf_iterations: iterations, p_salt: toBase64(salt), p_wrapped_key_pass: wrapped,
          p_recovery_kdf_iterations: null, p_recovery_salt: null, p_wrapped_key_recovery: null,
        });
      } finally {
        raw.fill(0);
      }
      await verifyRotated("pass", newPassword, token);
      emit("rotated");
    }
    async function rawToken(raw) {
      const key = await subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]);
      return tokenOfHkdfKey(key);
    }
    // หลังเปลี่ยนรหัส/ออกรหัสกู้คืนใหม่สำเร็จ: โหลดชุดที่เก็บอยู่บนเซิร์ฟเวอร์กลับมาแล้วถอดด้วยรหัสใหม่จริง ๆ ว่าได้ DEK ตัวเดิม (token ตรง)
    // ถ้าถอดไม่ได้ = ชุดใหม่ใช้ไม่ได้ ต้องบอกผู้ใช้ชัดเจน ห้ามทำเหมือนสำเร็จ (รหัสเดิมยังไม่ควรทิ้ง และให้ผู้ดูแลกู้จากประวัติ)
    async function verifyRotated(kind, text, expectedToken) {
      try {
        const state = await fetchState({ initialized: true });
        const part = kind === "recovery" ? state.recovery : state.pass;
        const kek = await deriveKek(text, part.salt, part.iterations);
        const raw = await openRaw(kek, part.wrapped, aadForWrap(state.isTest, kind === "recovery" ? "recovery" : "pass", state.keyVersion));
        try {
          if (toBase64(await rawToken(raw)) !== expectedToken) throw new VaultError("ROTATE_VERIFY_FAILED");
        } finally {
          raw.fill(0);
        }
      } catch {
        throw new VaultError("ROTATE_VERIFY_FAILED");
      }
    }
    // ออกรหัสกู้คืนใหม่ (สองจังหวะเหมือนตั้งครั้งแรก): เตรียม → แสดงรหัสให้จด → ผู้ใช้พิมพ์กลับ → ส่ง
    async function prepareNewRecovery({ kind, secret }) {
      const gen = generation;
      const context = getContext();
      const { state, raw } = await reauthenticate(kind, secret);
      try {
        const token = toBase64(await rawToken(raw));
        const recoveryCode = newRecoveryCode();
        const salt = randomBytes(SALT_BYTES);
        const kek = await deriveKek(recoveryCode, salt, iterations);
        const wrapped = await wrapRaw(kek, raw, aadForWrap(state.isTest, "recovery", state.keyVersion));
        if (interrupted(gen, context)) throw new VaultError("INTERRUPTED");
        pending = {
          type: "recovery", context, recoveryCode, token,
          params: {
            p_expected_rev: state.rev, p_action: "new_recovery", p_auth_token: token,
            p_kdf_iterations: null, p_salt: null, p_wrapped_key_pass: null,
            p_recovery_kdf_iterations: iterations, p_recovery_salt: toBase64(salt), p_wrapped_key_recovery: wrapped,
          },
        };
        return { recoveryCode: formatRecoveryCode(recoveryCode) };
      } finally {
        raw.fill(0);
      }
    }
    async function commitNewRecovery(typed) {
      const current = requirePending("recovery");
      if (normalizeRecoveryCode(typed) !== current.recoveryCode) throw new VaultError("CONFIRM_MISMATCH");
      pending = null;
      await callRotate(current.params);
      await verifyRotated("recovery", current.recoveryCode, current.token);
      emit("rotated");
    }

    /* ----- เข้ารหัส/ถอดรหัสช่องลับ ----- */
    function requireKeys() {
      ensureContext();
      if (!keys) throw new VaultError("LOCKED");
      return keys;
    }
    const aadForField = (assetId, fieldKey, keyVersion) => utf8(`${String(assetId).toLowerCase()}|${fieldKey}|${keyVersion}`);
    // plaintext ว่าง = null (ส่งไปเป็นการลบค่า) · nonce สุ่มใหม่ทุกครั้ง
    async function encryptField(assetId, fieldKey, plaintext) {
      const active = requireKeys();
      const gen = generation;
      const text = String(plaintext ?? "").normalize("NFC").trim();
      if (!text) return null;
      const bytes = utf8(text);
      if (bytes.length > MAX_PLAIN_BYTES) { bytes.fill(0); throw new VaultError("VALUE_TOO_LONG"); }
      const nonce = randomBytes(NONCE_BYTES);
      let cipher;
      try {
        cipher = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aadForField(assetId, fieldKey, active.keyVersion), tagLength: 128 }, active.aes, bytes));
      } catch {
        throw new VaultError("ENCRYPT_FAILED");
      } finally {
        bytes.fill(0);
      }
      if (gen !== generation) throw new VaultError("LOCKED"); // ถูกล็อกระหว่างเข้ารหัส: ไม่ส่งผลออกไป
      touch();
      return { v: 1, n: toBase64(nonce), c: toBase64(cipher) };
    }
    // ถอดไม่ได้ (AAD/กุญแจ/ข้อมูลไม่ตรง) = VaultError DECRYPT_FAILED ผู้เรียกแสดง "ถอดรหัสไม่ได้" เฉพาะช่องนั้น
    async function decryptField(assetId, fieldKey, envelope) {
      const active = requireKeys();
      const gen = generation;
      const parsed = validEnvelope(envelope);
      if (!parsed) throw new VaultError("DECRYPT_FAILED");
      let bytes;
      try {
        bytes = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: parsed.n, additionalData: aadForField(assetId, fieldKey, active.keyVersion), tagLength: 128 }, active.aes, parsed.c));
      } catch {
        throw new VaultError("DECRYPT_FAILED");
      }
      // ถูกล็อกระหว่างถอดรหัส: ห้ามคืนค่าที่ถอดได้ (ไม่งั้นค่าลับขึ้นหน้าหลังล็อกไปแล้ว)
      if (gen !== generation) { bytes.fill(0); throw new VaultError("LOCKED"); }
      try {
        touch();
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new VaultError("DECRYPT_FAILED");
      } finally {
        bytes.fill(0);
      }
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
    return Object.freeze({
      load, status, snapshot, unlock, lock, touch, checkIdle, ensureContext, subscribe,
      prepareSetup, commitSetup, cancelPending, changePassword, prepareNewRecovery, commitNewRecovery,
      encryptField, decryptField,
      // ใช้แสดงผลเท่านั้น (ไม่ใช่ความลับ)
      get isTest() { return info?.isTest ?? null; },
      get initialized() { return info?.initialized ?? null; },
      get hasPending() { return Boolean(pending); },
      get pendingType() { return pending?.type ?? null; },
      get iterations() { return iterations; },
    });
  }

  const api = {
    KDF, MIN_ITERATIONS, MAX_ITERATIONS, DEFAULT_ITERATIONS, MIN_PASSWORD_LENGTH, IDLE_MS, RECOVERY_LENGTH, RECOVERY_ALPHABET, MESSAGES,
    VaultError, createVault, parseVaultState, validEnvelope, authMaterialFromRaw, toBase64, fromBase64,
    formatRecoveryCode, normalizeRecoveryCode, isRecoveryFormat, passwordProblem, newUuid,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_ITAS_VAULT = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
