import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const { canHandleSound, canPlayNow, unreadChangeDecision, createNotificationSound, SOUND_MIN_GAP_MS, SOUND_PATH } = require("../../modules/notification-sound.js");

const GATE = { ready: true, unlocked: true, lastPlayedAt: 0, now: 100000 };

// ---------- กติกาตัดสินใจ ----------
test("a device can handle the sound only when the file is ready and the browser allows playback", () => {
  assert.equal(canHandleSound({ ready: true, unlocked: true }), true);
  assert.equal(canHandleSound({ ready: false, unlocked: true }), false);
  assert.equal(canHandleSound({ ready: true, unlocked: false }), false);
  assert.equal(canHandleSound(), false);
});

test("two sounds closer than the minimum gap are not played", () => {
  assert.equal(canPlayNow({ ...GATE, lastPlayedAt: GATE.now - SOUND_MIN_GAP_MS }), true);
  assert.equal(canPlayNow({ ...GATE, lastPlayedAt: GATE.now - SOUND_MIN_GAP_MS + 1 }), false);
  assert.equal(canPlayNow({ ...GATE, unlocked: false }), false);
});

test("the sound plays only when the unread number goes up", () => {
  assert.deepEqual(unreadChangeDecision({ previous: 2, next: 3, ...GATE }), { play: true, baseline: 3 });
  assert.deepEqual(unreadChangeDecision({ previous: 3, next: 3, ...GATE }), { play: false, baseline: 3 });
  assert.deepEqual(unreadChangeDecision({ previous: 3, next: 1, ...GATE }), { play: false, baseline: 1 });
  assert.deepEqual(unreadChangeDecision({ previous: 0, next: 5, ...GATE }), { play: true, baseline: 5 });
});

test("the first reading after loading or switching account never plays", () => {
  assert.deepEqual(unreadChangeDecision({ previous: null, next: 7, ...GATE }), { play: false, baseline: 7 });
  assert.deepEqual(unreadChangeDecision({ previous: undefined, next: 7, ...GATE }), { play: false, baseline: 7 });
});

test("a failed reading keeps the previous reference and never plays", () => {
  assert.deepEqual(unreadChangeDecision({ previous: 4, next: undefined, ...GATE }), { play: false, baseline: 4 });
  assert.deepEqual(unreadChangeDecision({ previous: 4, next: Number.NaN, ...GATE }), { play: false, baseline: 4 });
  assert.deepEqual(unreadChangeDecision({ previous: null, next: null, ...GATE }), { play: false, baseline: null });
});

test("an increase stays silent when the file is missing, locked, or just played", () => {
  assert.equal(unreadChangeDecision({ previous: 1, next: 2, ...GATE, ready: false }).play, false);
  assert.equal(unreadChangeDecision({ previous: 1, next: 2, ...GATE, unlocked: false }).play, false);
  assert.equal(unreadChangeDecision({ previous: 1, next: 2, ...GATE, lastPlayedAt: GATE.now - 1000 }).play, false);
  // ถึงจะไม่เล่น ก็ยังจำตัวเลขใหม่ไว้ (เล่นภายหลังด้วยส่วนต่างเก่าไม่ได้)
  assert.equal(unreadChangeDecision({ previous: 1, next: 2, ...GATE, ready: false }).baseline, 2);
});

// ---------- ตัวจัดการเสียง (ใส่ของปลอมแทนเบราว์เซอร์) ----------
function fakeEnvironment({ file = { ok: true, type: "audio/wav" }, playResult = "ok", pushWaitMs = 20 } = {}) {
  let clock = 1_000_000;
  const log = { fetched: [], plays: 0, mutedPlays: 0 };
  const audio = {
    muted: false,
    currentTime: 0,
    preload: "",
    play() {
      if (audio.muted) log.mutedPlays += 1;
      else log.plays += 1;
      return playResult === "ok" ? Promise.resolve() : Promise.reject(new Error("NotAllowedError"));
    },
    pause() {},
  };
  const posted = [];
  const channel = { postMessage: (message) => posted.push(message), onmessage: null };
  const fetchFile = async (url) => {
    log.fetched.push(url);
    if (file === "network-error") throw new TypeError("offline");
    return { ok: file.ok, headers: { get: () => file.type }, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  const sound = createNotificationSound({
    url: "./sounds/notify.wav?v=t", fetchFile, createAudio: () => audio, channel, now: () => clock, pushWaitMs,
  });
  return { sound, audio, log, posted, channel, advance: (ms) => { clock += ms; } };
}

const ready = async (options) => {
  const environment = fakeEnvironment(options);
  assert.equal(await environment.sound.probe(), true);
  assert.equal(await environment.sound.unlock(), true);
  return environment;
};

test("a missing sound file (404 or an HTML fallback page) means not ready and nothing ever plays", async () => {
  for (const file of [{ ok: false, type: "text/html" }, { ok: true, type: "text/html; charset=utf-8" }, { ok: false, type: "audio/wav" }]) {
    const { sound, log } = fakeEnvironment({ file });
    assert.equal(await sound.probe(), false);
    assert.equal(sound.isReady(), false);
    assert.equal(sound.canHandle(), false);
    assert.equal(await sound.unlock(), false);
    assert.equal(await sound.play(), "skipped");
    assert.equal(sound.observeUnread("a", 1), false);
    assert.equal(sound.observeUnread("a", 5), false);
    assert.equal(log.plays + log.mutedPlays, 0);
  }
});

test("a network error while checking the file is not remembered, so a later check can succeed", async () => {
  let attempts = 0;
  const audio = { play: () => Promise.resolve(), pause() {} };
  const sound = createNotificationSound({
    fetchFile: async () => { attempts += 1; if (attempts === 1) throw new TypeError("offline"); return { ok: true, headers: { get: () => "audio/wav" }, arrayBuffer: async () => new ArrayBuffer(1) }; },
    createAudio: () => audio,
  });
  assert.equal(await sound.probe(), false);
  assert.equal(await sound.probe(), true);
  assert.equal(attempts, 2);
});

test("the file is checked once even when probe is called many times", async () => {
  const { sound, log } = fakeEnvironment();
  await Promise.all([sound.probe(), sound.probe(), sound.probe()]);
  await sound.probe();
  assert.deepEqual(log.fetched, ["./sounds/notify.wav?v=t"]);
  assert.equal(SOUND_PATH, "./sounds/notify.wav");
});

test("unlocking plays a muted sample and then unmutes; a blocked browser stays locked", async () => {
  const unlocked = await ready();
  assert.equal(unlocked.log.mutedPlays, 1);
  assert.equal(unlocked.log.plays, 0);
  assert.equal(unlocked.audio.muted, false);
  assert.equal(unlocked.sound.canHandle(), true);

  const blocked = fakeEnvironment({ playResult: "blocked" });
  await blocked.sound.probe();
  assert.equal(await blocked.sound.unlock(), false);
  assert.equal(blocked.sound.canHandle(), false);
  assert.equal(blocked.audio.muted, false);
});

test("unlock starts the muted play synchronously when the file is ready, so it still counts as the user's tap", async () => {
  const { sound, log } = fakeEnvironment();
  await sound.probe();
  const pending = sound.unlock();
  assert.equal(log.mutedPlays, 1); // ก่อน await ใด ๆ
  assert.equal(await pending, true);
});

test("every gesture retries the unlock until it works, and nothing can play or be promised before that", async () => {
  const environment = fakeEnvironment();
  await environment.sound.probe();
  environment.audio.play = () => Promise.reject(new Error("NotAllowedError"));
  assert.equal(await environment.sound.unlock(), false);
  assert.equal(await environment.sound.unlock(), false);
  assert.equal(environment.sound.canHandle(), false); // sw.js จะได้คำตอบว่าไม่เล่น → เสียงระบบ
  assert.equal(await environment.sound.play(), "skipped");
  environment.audio.play = () => Promise.resolve();
  assert.equal(await environment.sound.unlock(), true);
  assert.equal(environment.sound.canHandle(), true);
  assert.equal(await environment.sound.play(), "played");
});

test("a real play the browser blocks relocks the sound so the next tap unlocks it again", async () => {
  const environment = await ready();
  environment.audio.play = () => Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
  assert.equal(await environment.sound.playForPush(), "fallback");
  assert.equal(environment.sound.canHandle(), false);
  environment.audio.play = () => Promise.resolve();
  assert.equal(await environment.sound.unlock(), true);
  assert.equal(await environment.sound.playForPush(), "played");
  // ความล้มแบบอื่น (ไม่ใช่ถูกบล็อก) ไม่ทำให้กลับไปล็อก
  environment.advance(SOUND_MIN_GAP_MS);
  environment.audio.play = () => Promise.reject(new Error("decode"));
  assert.equal(await environment.sound.play(), "failed");
  assert.equal(environment.sound.canHandle(), true);
});

test("play restarts the file, tells other tabs, and refuses a second sound inside the gap", async () => {
  const { sound, audio, log, posted, advance } = await ready();
  audio.currentTime = 2;
  assert.equal(await sound.play(), "played");
  assert.equal(audio.currentTime, 0);
  assert.equal(log.plays, 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, "played");
  assert.equal(await sound.play(), "skipped");
  advance(SOUND_MIN_GAP_MS - 1);
  assert.equal(await sound.play(), "skipped");
  advance(1);
  assert.equal(await sound.play(), "played");
  assert.equal(log.plays, 2);
});

test("a browser that refuses to play reports failed and does not start the gap", async () => {
  const environment = await ready();
  environment.audio.play = () => Promise.reject(new Error("NotAllowedError"));
  assert.equal(await environment.sound.play(), "failed");
  environment.audio.play = () => Promise.resolve();
  assert.equal(await environment.sound.play(), "played");
});

// ---------- เล่นเสียงให้ push ที่รับปากไว้: ต้องจบด้วย เสียงดัง / เพิ่งดัง / แจ้งเตือนสำรอง เสมอ ----------
test("playForPush plays the sound when nothing else just played", async () => {
  const { sound, log } = await ready();
  assert.equal(await sound.playForPush(), "played");
  assert.equal(log.plays, 1);
});

test("two pushes inside the gap: the second is covered by the first sound, never silent-without-sound", async () => {
  const { sound, log, advance } = await ready();
  assert.equal(await sound.playForPush(), "played");
  advance(1000);
  assert.equal(await sound.playForPush(), "covered");
  assert.equal(log.plays, 1);
  advance(SOUND_MIN_GAP_MS);
  assert.equal(await sound.playForPush(), "played");
  assert.equal(log.plays, 2);
});

test("two pushes at the same moment: one sound, the other covered", async () => {
  const { sound, log } = await ready();
  const results = await Promise.all([sound.playForPush(), sound.playForPush()]);
  assert.deepEqual(results.sort(), ["covered", "played"]);
  assert.equal(log.plays, 1);
});

test("playForPush asks for the fallback when the sound is not ready or not unlocked", async () => {
  const missing = fakeEnvironment({ file: { ok: false, type: "text/html" } });
  await missing.sound.probe();
  assert.equal(await missing.sound.playForPush(), "fallback");
  const locked = fakeEnvironment();
  await locked.sound.probe(); // ยังไม่ unlock
  assert.equal(await locked.sound.playForPush(), "fallback");
  assert.equal(locked.log.plays, 0);
});

test("playForPush asks for the fallback when the browser refuses to play, and a failed play does not start the gap", async () => {
  const environment = await ready();
  environment.audio.play = () => Promise.reject(new Error("NotAllowedError"));
  assert.equal(await environment.sound.playForPush(), "fallback");
  environment.audio.play = () => Promise.resolve();
  assert.equal(await environment.sound.playForPush(), "played");
});

test("two pushes at once while the browser refuses: neither is treated as covered", async () => {
  const environment = await ready();
  environment.audio.play = () => Promise.reject(new Error("NotAllowedError"));
  assert.deepEqual(await Promise.all([environment.sound.playForPush(), environment.sound.playForPush()]), ["fallback", "fallback"]);
});

test("playForPush falls back when audio.play() never settles, and stops the stuck playback", async () => {
  const environment = await ready();
  let paused = 0;
  environment.audio.pause = () => { paused += 1; };
  environment.audio.play = () => new Promise(() => {}); // ไฟล์โหลดค้าง ไม่ resolve ไม่ reject
  assert.equal(await environment.sound.playForPush(), "fallback");
  assert.equal(paused, 1);
});

test("a push waiting on a stuck earlier play falls back instead of waiting forever or playing twice", async () => {
  const environment = await ready();
  let plays = 0;
  environment.audio.play = () => { plays += 1; return new Promise(() => {}); };
  const first = environment.sound.play(); // เริ่มแล้วค้าง (inflight)
  assert.equal(await environment.sound.playForPush(), "fallback");
  assert.equal(plays, 1); // ไม่เล่นซ้อน
  void first;
});

test("after a stuck play times out, the gap is released so the next push can still play", async () => {
  const environment = await ready();
  environment.audio.pause = () => {};
  let rejectStuck;
  environment.audio.play = () => new Promise((_, reject) => { rejectStuck = reject; });
  assert.equal(await environment.sound.playForPush(), "fallback");
  rejectStuck(new Error("AbortError")); // pause() ยกเลิก play ที่ค้าง
  await new Promise((resolve) => setTimeout(resolve, 0));
  environment.audio.play = () => Promise.resolve();
  assert.equal(await environment.sound.playForPush(), "played");
});

test("a broken channel after the sound really played still counts as played, with no fallback and no retry", async () => {
  const environment = await ready();
  environment.channel.postMessage = () => { throw new Error("channel closed"); };
  assert.equal(await environment.sound.play(), "played");
  assert.equal(environment.log.plays, 1);
  // ช่วงกันซ้ำยังอยู่ → push ถัดมาถือว่าเสียงครอบคลุมแล้ว ไม่ใช่ fallback
  assert.equal(await environment.sound.playForPush(), "covered");
  assert.equal(environment.log.plays, 1);
});

test("a sound another tab just played also covers a push", async () => {
  const { sound, channel, log } = await ready();
  channel.onmessage({ data: { type: "played", at: 1, owner: "emp-1", count: 2 } });
  assert.equal(await sound.playForPush(), "covered");
  assert.equal(log.plays, 0);
});

test("observeUnread: first reading is silent, an increase plays once, a decrease and repeats are silent", async () => {
  const { sound, log, advance } = await ready();
  assert.equal(sound.observeUnread("emp-1", 3), false);
  assert.equal(sound.observeUnread("emp-1", 3), false);
  assert.equal(sound.observeUnread("emp-1", 4), true);
  await Promise.resolve();
  assert.equal(log.plays, 1);
  advance(SOUND_MIN_GAP_MS);
  assert.equal(sound.observeUnread("emp-1", 2), false);
  assert.equal(sound.observeUnread("emp-1", 2), false);
  assert.equal(log.plays, 1);
});

test("observeUnread with announce off only remembers the number", async () => {
  const { sound, log } = await ready();
  sound.observeUnread("emp-1", 1);
  assert.equal(sound.observeUnread("emp-1", 2, { announce: false }), false);
  // ตัวเลขถูกจำแล้ว ครั้งถัดไปที่เท่ากันจึงไม่ใช่ของใหม่
  assert.equal(sound.observeUnread("emp-1", 2), false);
  assert.equal(log.plays, 0);
});

test("a different account starts from a fresh reference instead of comparing with the previous user", async () => {
  const { sound, log } = await ready();
  sound.observeUnread("emp-1", 1);
  assert.equal(sound.observeUnread("emp-2", 9), false);
  assert.equal(log.plays, 0);
  assert.equal(sound.observeUnread("emp-2", 10), true);
});

test("reading an item lowers the reference so a new arrival at the same moment still plays", async () => {
  const { sound } = await ready();
  sound.observeUnread("emp-1", 3);
  sound.setBaseline("emp-1", 2); // ผู้ใช้อ่านไป 1 รายการ
  // ระหว่างนั้นมีของใหม่เข้ามา 1 → ฐานข้อมูลยังนับได้ 3 = เพิ่มจาก 2
  assert.equal(sound.observeUnread("emp-1", 3), true);
});

test("a failed count (no number) never changes the reference or plays", async () => {
  const { sound } = await ready();
  sound.observeUnread("emp-1", 3);
  assert.equal(sound.observeUnread("emp-1", undefined), false);
  assert.equal(sound.observeUnread("emp-1", 3), false);
});

test("the same event seen through push and polling plays once", async () => {
  const { sound, log } = await ready();
  sound.observeUnread("emp-1", 1);
  // ทางที่ 1: push บอกว่ามีของใหม่ → เล่น
  assert.equal(await sound.play(), "played");
  // ทางที่ 2: ถามฐานข้อมูลทีหลังไม่กี่วินาที เห็นตัวเลขเพิ่ม → อยู่ในช่วงกันซ้ำ ไม่เล่นอีก
  sound.observeUnread("emp-1", 2);
  await Promise.resolve();
  assert.equal(log.plays, 1);
});

test("a tab that hears another tab play does not play the same event again", async () => {
  const first = await ready();
  const second = await ready();
  first.sound.observeUnread("emp-1", 1);
  second.sound.observeUnread("emp-1", 1);
  // แท็บแรกเห็นตัวเลขเพิ่มและเล่น แล้วแท็บสองได้ข้อความจาก channel
  first.sound.observeUnread("emp-1", 2);
  await Promise.resolve();
  assert.equal(first.log.plays, 1);
  const message = first.posted[0];
  assert.equal(message.owner, "emp-1");
  assert.equal(message.count, 2);
  second.channel.onmessage({ data: message });
  // แท็บสองถามฐานข้อมูลทีหลัง (นานกว่ากันซ้ำ) แล้วเห็น 2 เท่ากับที่แท็บแรกบอก → ไม่เพิ่ม ไม่เล่น
  second.advance(SOUND_MIN_GAP_MS + 1);
  assert.equal(second.sound.observeUnread("emp-1", 2), false);
  assert.equal(second.log.plays, 0);
  // ของใหม่จริงอีกชิ้นยังเล่นตามปกติ
  assert.equal(second.sound.observeUnread("emp-1", 3), true);
});

test("a message from another tab about a different account does not move the reference", async () => {
  const { sound, channel, advance } = await ready();
  sound.observeUnread("emp-1", 1);
  channel.onmessage({ data: { type: "played", at: 1, owner: "emp-2", count: 50 } });
  advance(SOUND_MIN_GAP_MS + 1);
  assert.equal(sound.observeUnread("emp-1", 2), true);
});

// ---------- service worker: แจ้งเตือนต้องแสดงเสมอ และ silent เฉพาะเมื่อหน้ารับปากว่าจะเล่นเสียง ----------
const swSource = readFileSync(new URL("../../sw.js", import.meta.url), "utf8");

// รัน sw.js ในกล่องทราย: จับ handler ที่ลงทะเบียน, ใส่หน้าต่างปลอม (reply = ค่าที่หน้านั้นจะตอบผ่าน MessageChannel)
function loadServiceWorker({ windows = [], matchAllError = null } = {}) {
  const handlers = {};
  const shown = [];
  const scope = "https://example.test/app/";
  const clients = windows.map((spec) => ({
    url: spec.url ?? `${scope}index.html`,
    visibilityState: spec.visibilityState ?? "visible",
    focused: spec.focused ?? true,
    received: [],
    postMessage(message, transfer) {
      if (spec.throws) throw new Error("detached");
      this.received.push(message);
      const port = transfer?.[0];
      if (port && spec.reply !== undefined && spec.reply !== "never") port.postMessage({ willPlaySound: spec.reply });
    },
  }));
  const self = {
    addEventListener: (name, handler) => { handlers[name] = handler; },
    skipWaiting() {},
    registration: { scope, showNotification: async (title, options) => { shown.push({ title, options }); } },
    clients: {
      claim: async () => {},
      openWindow: async () => {},
      matchAll: async (options) => {
        assert.deepEqual(JSON.parse(JSON.stringify(options)), { type: "window", includeUncontrolled: true });
        if (matchAllError) throw matchAllError;
        return clients;
      },
    },
  };
  const context = vm.createContext({ self, MessageChannel, URL, Response, fetch: () => {}, setTimeout, clearTimeout, console });
  vm.runInContext(swSource, context);
  const push = async (data, { raw } = {}) => {
    let pending = Promise.resolve();
    handlers.push({ data: raw !== undefined ? { json: () => { throw new Error("bad json"); } } : { json: () => data }, waitUntil: (promise) => { pending = promise; } });
    await pending;
  };
  return { push, shown, clients };
}

// ออบเจ็กต์ที่สร้างในกล่องทราย (vm) มี prototype คนละชุด ต้องแปลงเป็นข้อมูลล้วนก่อนเทียบ
const plain = (value) => JSON.parse(JSON.stringify(value));
const PAYLOAD = { title: "ใบสั่งงานรออนุมัติ", url: "#/notifications", tag: "n-1" };

test("push with no open app window shows a normal notification with sound", async () => {
  const worker = loadServiceWorker();
  await worker.push(PAYLOAD);
  assert.equal(worker.shown.length, 1);
  assert.equal(worker.shown[0].title, PAYLOAD.title);
  assert.equal(worker.shown[0].options.silent, undefined);
  assert.equal(worker.shown[0].options.tag, "n-1");
  assert.deepEqual(plain(worker.shown[0].options.data), { url: "#/notifications" });
});

test("a focused visible page that promises to play the company sound makes the notification silent", async () => {
  const worker = loadServiceWorker({ windows: [{ reply: true }] });
  await worker.push(PAYLOAD);
  assert.equal(worker.shown[0].options.silent, true);
  assert.deepEqual(plain(worker.clients[0].received[0]), { type: "mnp-notification", ...PAYLOAD });
});

test("a focused page that declines (sound off, file missing, locked) leaves the system sound on", async () => {
  const worker = loadServiceWorker({ windows: [{ reply: false }] });
  await worker.push(PAYLOAD);
  assert.equal(worker.shown.length, 1);
  assert.equal(worker.shown[0].options.silent, undefined);
});

test("a page that does not answer in time cannot silence the notification", async () => {
  const worker = loadServiceWorker({ windows: [{ reply: "never" }] });
  await worker.push(PAYLOAD);
  assert.equal(worker.shown[0].options.silent, undefined);
});

test("a hidden or unfocused page is only told to refresh and never silences the notification", async () => {
  const worker = loadServiceWorker({ windows: [{ visibilityState: "hidden", focused: false, reply: true }, { visibilityState: "visible", focused: false, reply: true }] });
  await worker.push(PAYLOAD);
  assert.equal(worker.shown[0].options.silent, undefined);
  for (const client of worker.clients) assert.equal(client.received.length, 1);
});

test("with several tabs, one focused tab that promises is enough to silence", async () => {
  const worker = loadServiceWorker({ windows: [{ visibilityState: "hidden", focused: false }, { reply: true }] });
  await worker.push(PAYLOAD);
  assert.equal(worker.shown[0].options.silent, true);
});

test("pages outside the service worker scope are ignored", async () => {
  const worker = loadServiceWorker({ windows: [{ url: "https://other.test/", reply: true }] });
  await worker.push(PAYLOAD);
  assert.equal(worker.shown[0].options.silent, undefined);
  assert.equal(worker.clients[0].received.length, 0);
});

test("the notification is still shown when listing or messaging the pages fails", async () => {
  const broken = loadServiceWorker({ matchAllError: new Error("boom") });
  await broken.push(PAYLOAD);
  assert.equal(broken.shown.length, 1);
  assert.equal(broken.shown[0].options.silent, undefined);

  const detached = loadServiceWorker({ windows: [{ throws: true }, { visibilityState: "hidden", focused: false, throws: true }] });
  await detached.push(PAYLOAD);
  assert.equal(detached.shown.length, 1);
  assert.equal(detached.shown[0].options.silent, undefined);
});

test("a push without a readable payload still shows the default notification", async () => {
  const worker = loadServiceWorker({ windows: [{ reply: false }] });
  await worker.push(null, { raw: true });
  assert.equal(worker.shown.length, 1);
  assert.equal(worker.shown[0].title, "มีการแจ้งเตือนใหม่");
  assert.deepEqual(plain(worker.shown[0].options.data), { url: "#/notifications" });
});

test("a push without a tag gets a generated tag that the page is told about, so a fallback can replace the silent one", async () => {
  for (const payload of [{ title: "ไม่มี tag", url: "#/notifications" }, { title: "tag ว่าง", url: "#/notifications", tag: "" }, { title: "tag ไม่ใช่ข้อความ", url: "#/notifications", tag: 5 }]) {
    const worker = loadServiceWorker({ windows: [{ reply: true }] });
    await worker.push(payload);
    const shownTag = worker.shown[0].options.tag;
    assert.match(shownTag, /^mnp-push-/);
    assert.equal(worker.clients[0].received[0].tag, shownTag);
    assert.equal(worker.shown[0].options.silent, true);
  }
  // สองใบที่ไม่มี tag ไม่ทับกัน
  const worker = loadServiceWorker();
  await worker.push({ title: "ก" });
  await worker.push({ title: "ข" });
  assert.notEqual(worker.shown[0].options.tag, worker.shown[1].options.tag);
});

test("a payload tag is passed to the page unchanged", async () => {
  const worker = loadServiceWorker({ windows: [{ reply: true }] });
  await worker.push(PAYLOAD);
  assert.equal(worker.clients[0].received[0].tag, "n-1");
  assert.equal(worker.shown[0].options.tag, "n-1");
});

test("a push with a body shows it and tells the page; a push without one adds no body at all", async () => {
  const digest = { title: "แจ้งเตือนที่คุณพลาดระหว่างพัก", body: "คุณมี 3 แจ้งเตือนที่ยังไม่ได้อ่าน", url: "#/notifications", tag: "pause-digest-e1" };
  const worker = loadServiceWorker({ windows: [{ reply: false }] });
  await worker.push(digest);
  assert.equal(worker.shown[0].options.body, digest.body);
  assert.deepEqual(plain(worker.clients[0].received[0]), { type: "mnp-notification", ...digest });
  // payload ปกติของ notify-push ไม่มี body → ไม่มีคีย์ body ทั้งใน showNotification และข้อความหาหน้า
  const plainPush = loadServiceWorker({ windows: [{ reply: false }] });
  await plainPush.push(PAYLOAD);
  assert.equal("body" in plainPush.shown[0].options, false);
  assert.equal("body" in plainPush.clients[0].received[0], false);
  // body ว่างหรือไม่ใช่ข้อความ = ไม่แสดง
  for (const body of ["", 7, null]) {
    const worker2 = loadServiceWorker();
    await worker2.push({ ...PAYLOAD, body });
    assert.equal("body" in worker2.shown[0].options, false);
  }
});

// ---------- app.js: ต้องต่อเข้ากับตัวจัดการเสียงจริง ----------
const appSource = readFileSync(new URL("../../app.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");

test("the page fallback notification carries the same body as the silent one it replaces", async () => {
  const shown = [];
  const context = vm.createContext({
    serviceWorkerReady: async () => ({ showNotification: async (title, options) => { shown.push({ title, options }); } }),
    console,
  });
  const start = appSource.indexOf("async function showSoundFallbackNotification(");
  vm.runInContext(appSource.slice(start, appSource.indexOf("\n}\n", start) + 3), context);
  const fallback = vm.runInContext("showSoundFallbackNotification", context);
  await fallback({ title: "หัวเรื่อง", body: "เนื้อความ", url: "#/notifications", tag: "pause-digest-e1" });
  await fallback({ title: "ปกติ", url: "#/notifications", tag: "n-1" });
  assert.equal(shown[0].options.body, "เนื้อความ");
  assert.equal(shown[0].options.tag, "pause-digest-e1");
  assert.equal("body" in shown[1].options, false);
});

test("the sound has no user interface at all: no panel, no switch, no preview, no saved setting", () => {
  assert.doesNotMatch(appSource, /sound-panel|refreshSoundPanel|data-sound-|notifySound\.(setEnabled|isEnabled|isActive|play\(\{)|mnp-notify-sound/);
  assert.doesNotMatch(readFileSync(new URL("../../styles.css", import.meta.url), "utf8"), /sound-panel/);
  assert.doesNotMatch(readFileSync(new URL("../../modules/notification-sound.js", import.meta.url), "utf8"), /localStorage|setEnabled|preview/);
});

test("the unlock listeners stay armed so a browser that blocks again can be unlocked by the next tap", () => {
  const arm = appSource.slice(appSource.indexOf("function armSoundUnlock("), appSource.indexOf("// รอบถามฐานข้อมูล"));
  assert.match(arm, /if \(COMPANY_NOTIFY_SOUND_ENABLED && notifySound\.isReady\(\)\) notifySound\.unlock\(\);/);
  assert.match(arm, /\["pointerdown", "keydown"\]\.forEach/);
  assert.doesNotMatch(arm, /removeEventListener/);
});

test("a push-driven reload never announces by itself, and a failed count is not compared", () => {
  const load = appSource.slice(appSource.indexOf("async function loadUnread("), appSource.indexOf("const NAV_ICONS"));
  assert.match(load, /announce && COMPANY_NOTIFY_SOUND_ENABLED && !isSandboxMode\(\)/);
  assert.match(load, /if \(!error\) \{\n {4}state\.unread = count \?\? 0;\n {4}observe\(count\);/);
  const push = appSource.slice(appSource.indexOf("async function onNotificationPushMessage("), appSource.indexOf("async function showSoundFallbackNotification("));
  assert.match(push, /loadUnread\(\{ announce: false \}\)/);
  // ไม่รับปากเล่นเสียงในโหมดทดสอบ/lab-only
  assert.match(push, /COMPANY_NOTIFY_SOUND_ENABLED && Boolean\(state\.employee\) && !isLabOnly\(\) && !isSandboxMode\(\) && notifySound\.canHandle\(\)/);
});

test("a failed count keeps the old unread number in both branches so the bell badge does not vanish", () => {
  const load = appSource.slice(appSource.indexOf("async function loadUnread("), appSource.indexOf("const NAV_ICONS"));
  assert.doesNotMatch(load, /state\.unread = 0/);
});

test("a push that times out waiting for the unread count redraws the badge when the count arrives late", () => {
  const push = appSource.slice(appSource.indexOf("async function onNotificationPushMessage("), appSource.indexOf("async function showSoundFallbackNotification("));
  assert.match(push, /const refresh = loadUnread\(\{ announce: false \}\);/);
  assert.match(push, /withTimeout\(refresh, 1500/);
  assert.match(push, /refresh\.then\(redrawBadges/);
  // วาดป้ายพังต้องไม่ขวางเส้นทางเสียง/แจ้งเตือนสำรอง
  assert.match(push, /try \{\n\s*updateUnreadBadges\(\);\n\s*\} catch/);
});

test("a promised push sound ends in a sound or the fallback notification", () => {
  const push = appSource.slice(appSource.indexOf("async function onNotificationPushMessage("), appSource.indexOf("async function showSoundFallbackNotification("));
  assert.match(push, /\(await notifySound\.playForPush\(\)\) === "fallback"\) await showSoundFallbackNotification\(message\)/);
  assert.doesNotMatch(push, /notifySound\.play\(/);
});

test("clicking a notification does not navigate if the user already went elsewhere while waiting", () => {
  const click = appSource.slice(appSource.indexOf("function bindNotificationReadOnClick("), appSource.indexOf("// ---------- แถบชวนเปิดแจ้งเตือนบนเครื่อง"));
  assert.match(click, /const hashAtClick = location\.hash;/);
  assert.match(click, /if \(location\.hash !== hashAtClick\) return;\n\s*location\.hash = href;/);
});

test("the index loads the sound module before app.js", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf("modules/notification-sound.js") > 0);
  assert.ok(html.indexOf("modules/notification-sound.js") < html.indexOf("./app.js?v="));
});

// ---------- ธงปิดเสียงบริษัท (เจ้าของสั่ง 25/11/2026) ----------
test("the company sound flag is defined once, and is off so the operating system plays its own sound", () => {
  assert.equal(appSource.match(/^const COMPANY_NOTIFY_SOUND_ENABLED = (true|false);$/gm)?.length, 1);
  assert.match(appSource, /^const COMPANY_NOTIFY_SOUND_ENABLED = false;$/m);
});

test("with the flag off every path that could play the company sound is gated by it", () => {
  const push = appSource.slice(appSource.indexOf("async function onNotificationPushMessage("), appSource.indexOf("async function showSoundFallbackNotification("));
  // ตอบ sw.js ด้วย canPlay ซึ่งต้องเป็น false เมื่อธงปิด (sw.js จึงไม่ทำ silent)
  assert.match(push, /const canPlay = COMPANY_NOTIFY_SOUND_ENABLED && /);
  assert.match(push, /postMessage\(\{ willPlaySound: canPlay \}\)/);
  const poll = appSource.slice(appSource.indexOf("async function pollUnreadForSound("), appSource.indexOf("// ข้อความจาก sw.js ตอนมี push เข้า"));
  assert.match(poll, /COMPANY_NOTIFY_SOUND_ENABLED && !notifySound\.isReady\(\)/);
  // รอบถามยังไม่อ่านยังอัปเดตป้ายกระดิ่งอยู่ (ไม่ถูกตัดทิ้งเมื่อธงปิด)
  assert.match(poll, /await loadUnread\(\);\n\s*updateUnreadBadges\(\);/);
  assert.match(appSource, /COMPANY_NOTIFY_SOUND_ENABLED && !isLabOnly\(\) && !isSandboxMode\(\)\) notifySound\.probe\(\)/);
});
