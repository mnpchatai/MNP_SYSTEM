// ปุ่ม "ติดตั้งแอป" ในหน้าเข้าสู่ระบบ: ตัดสินว่าเบราว์เซอร์นี้ติดตั้งแบบไหนได้
//   "prompt" = Chrome/Edge (Android/คอมพิวเตอร์) ส่ง beforeinstallprompt มาแล้ว กดปุ่มแล้วติดตั้งได้ทันที
//   "ios"    = Safari บน iPhone/iPad: Apple ไม่เปิดให้เว็บสั่งติดตั้ง ปุ่มจึงเปิดหน้าต่างสอนขั้นตอนแทน
//   null     = ซ่อนปุ่ม (เปิดจากแอปที่ติดตั้งแล้ว หรือเบราว์เซอร์ที่ติดตั้งไม่ได้ เช่น Chrome บน iPhone, LINE)
(function () {
  const IOS_OTHER_BROWSERS = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Line\/|FBAN|FBAV|Instagram/;

  function isIos({ userAgent = "", platform = "", maxTouchPoints = 0 }) {
    // iPadOS 13 ขึ้นไปแจ้งตัวเป็น Mac จึงดูจากจอสัมผัสร่วมด้วย
    return /iPhone|iPad|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  }

  function installMode({ standalone = false, hasPrompt = false, userAgent = "", platform = "", maxTouchPoints = 0 } = {}) {
    if (standalone) return null;
    if (hasPrompt) return "prompt";
    if (isIos({ userAgent, platform, maxTouchPoints }) && /Safari\//.test(userAgent) && !IOS_OTHER_BROWSERS.test(userAgent)) return "ios";
    return null;
  }

  const api = { installMode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.MNP_INSTALL_APP = api;
})();
