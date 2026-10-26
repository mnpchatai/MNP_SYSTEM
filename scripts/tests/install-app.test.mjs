import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { installMode } = createRequire(import.meta.url)("../../modules/install-app.js");

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const IPHONE_LINE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0";
const IPHONE_WEBVIEW = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

test("an installed app never shows the install button", () => {
  assert.equal(installMode({ standalone: true, hasPrompt: true }), null);
  assert.equal(installMode({ standalone: true, userAgent: IPHONE_SAFARI }), null);
});

test("a browser that offered beforeinstallprompt installs directly", () => {
  assert.equal(installMode({ hasPrompt: true, userAgent: ANDROID_CHROME }), "prompt");
});

test("Safari on iPhone and iPad gets the step-by-step guide", () => {
  assert.equal(installMode({ userAgent: IPHONE_SAFARI }), "ios");
  assert.equal(installMode({ userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 5 }), "ios");
  assert.equal(installMode({ userAgent: IPAD_AS_MAC, platform: "iPhone", maxTouchPoints: 5 }), "ios"); // ขอเว็บไซต์เดสก์ท็อป
});

test("browsers that cannot add to the home screen hide the button", () => {
  assert.equal(installMode({ userAgent: IPHONE_CHROME }), null);
  assert.equal(installMode({ userAgent: IPHONE_LINE }), null);
  assert.equal(installMode({ userAgent: IPHONE_WEBVIEW }), null); // เบราว์เซอร์ในแอปอื่น ไม่มี Version/
  assert.equal(installMode({ userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 0 }), null); // Mac จริง
  assert.equal(installMode({ userAgent: ANDROID_CHROME }), null); // ยังไม่ได้รับ beforeinstallprompt
  assert.equal(installMode(), null);
});
