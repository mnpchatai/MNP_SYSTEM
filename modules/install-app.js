// แถบชวนติดตั้งแอป (app.js: refreshInstallBanner): ตัดสินว่าเบราว์เซอร์นี้ติดตั้งแบบไหนได้
//   "prompt" = Chrome/Edge (Android/คอมพิวเตอร์) ส่ง beforeinstallprompt มาแล้ว แถบมีปุ่มติดตั้งได้ทันที
//   "ios"    = Safari บน iPhone/iPad: Apple ไม่เปิดให้เว็บสั่งติดตั้ง แถบจึงบอกปุ่มของ Safari ที่ต้องแตะแทน
//   null     = ไม่แสดงแถบ: เปิดจากแอปที่ติดตั้งแล้ว, เบราว์เซอร์ในแอปอื่น (LINE ฯลฯ) ที่เพิ่มลงหน้าจอไม่ได้
//              และ Chrome/Firefox/Edge บน iOS ซึ่งเพิ่มได้จากเมนูแชร์ของตัวเองแต่ขั้นตอนต่างจาก Safari
//              จึงไม่แสดงคำแนะนำที่ทำตามไม่ได้
(function () {
  const IOS_OTHER_BROWSERS = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Line\/|FBAN|FBAV|Instagram/;

  function isIos({ userAgent = "", platform = "", maxTouchPoints = 0 }) {
    // iPadOS 13 ขึ้นไปและโหมด "ขอเว็บไซต์เดสก์ท็อป" แจ้ง UA เป็น Mac จึงดู platform และจอสัมผัสร่วมด้วย
    return /iPhone|iPad|iPod/.test(userAgent) || /iPhone|iPad|iPod/.test(platform) || (platform === "MacIntel" && maxTouchPoints > 1);
  }

  function installMode({ standalone = false, hasPrompt = false, userAgent = "", platform = "", maxTouchPoints = 0 } = {}) {
    if (standalone) return null;
    if (hasPrompt) return "prompt";
    // Safari จริงมี "Version/x" เสมอ เบราว์เซอร์ในแอปอื่นส่วนใหญ่ (WKWebView) ไม่มี
    const safari = /Version\/\d/.test(userAgent) && /Safari\//.test(userAgent) && !IOS_OTHER_BROWSERS.test(userAgent);
    if (isIos({ userAgent, platform, maxTouchPoints }) && safari) return "ios";
    return null;
  }

  const api = { installMode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.MNP_INSTALL_APP = api;
})();
