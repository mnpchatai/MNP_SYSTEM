// โมดูล MNP LAB ของ Pilot Web (#/lab) — ห้องปฏิบัติการ เริ่มที่ผลทดสอบ Mooney
//
// ข้อมูลสดจากสเปรดชีต Mooney_Test_Report: ทุกครั้งที่เปิดหน้าและทุก 30 วินาทีที่แท็บเปิดอยู่ เว็บเรียก Web App ของ
// Apps Script (apps-script/lab-mooney/Code.gs) ซึ่งอ่านชีต ณ ตอนนั้นแล้วตอบกลับ ไม่มีสำเนาในฐานข้อมูลหรือที่อื่น
// (Google Sheets ส่งข้อมูลมาหาเบราว์เซอร์เองไม่ได้ จึงใช้การอ่านซ้ำถี่ๆ แทน)
//
// สิทธิ์: ตอนนี้เฉพาะ admin — เว็บแนบ access token ของผู้ใช้ไปกับคำขอ Apps Script ถามฐานข้อมูล (RPC app_lab_access →
// private.can_access_lab) ด้วยโทเค็นนั้นก่อนคืนข้อมูล ภายหลังเพิ่มรายชื่อ ID ที่เข้าได้ที่ฟังก์ชันนั้นจุดเดียว
// หน้าเว็บแค่ซ่อนเมนู (navAllowed) และไม่วาดหน้าเมื่อ state.employee.labAccess ไม่เป็น true ซึ่งเป็น UX ไม่ใช่ตัวบังคับสิทธิ์
// ผู้ที่ไม่มีสิทธิ์เห็นหน้า "ไม่พบหน้าที่ต้องการ" เหมือน URL ที่ไม่มีอยู่จริง และไม่มีคำขอไป Apps Script
//
// เป็นโมดูลแยก (standalone: true) ไม่ใช่โมดูลคำร้อง: มีเมนูข้างของตัวเอง ไม่มีการ์ดในหน้าสร้างคำร้อง และยังไม่รองรับโหมดทดสอบ
// (sandbox ไม่ประกาศ จึงถูกซ่อนในโหมดทดสอบ) ไม่มีฝั่ง Next.js เพราะ Pilot Web เป็นหน้าที่ใช้งานจริงตอนนี้
//
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — เรียก helper ของ app.js (state, sb, app, shell, bindShell, loadingShell,
// renderNotFound, escapeHtml) เฉพาะตอนเปิดหน้า ไม่เรียกตอนโหลดไฟล์
(function registerLabModule() {
  const model = window.MNP_LAB_MOONEY;
  if (!model) return;

  const PATH = "lab";
  const TITLE = "MNP LAB";
  // Web App ที่ deploy จาก apps-script/lab-mooney/Code.gs (Execute as: Me, Who has access: Anyone) — URL นี้ไม่ใช่ความลับ
  // เพราะ Web App คืนข้อมูลเฉพาะเมื่อมีโทเค็นของผู้มีสิทธิ์ ว่าง = ยังไม่ตั้งค่า
  const FEED_URL = "https://script.google.com/macros/s/AKfycbyorWZ40Rkt9YCoN4M1YvOTV3vlmLVjRv7rk9gxjGzzFnJApzZ2zHiMnGKE6Vu7zgWO/exec";
  const REFRESH_MS = 30 * 1000;
  const NAV_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9V3"/><path d="M7.5 15h9"/></svg>`;

  const MATERIAL_COLUMNS = [
    { label: "วัสดุ" },
    { label: "จำนวนผล", numeric: true },
    { label: "จำนวนวันที่ทดสอบ", numeric: true },
    { label: "ทดสอบครั้งแรก", numeric: true },
    { label: "ทดสอบล่าสุด", numeric: true },
  ];
  const RESULT_COLUMNS = [
    { label: "ID" },
    { label: "วันที่", numeric: true },
    { label: "เวลา", numeric: true },
    { label: "อุณหภูมิ (°C)", numeric: true },
    { label: "เวลาทดสอบ (นาที)", numeric: true },
    { label: "MH", numeric: true },
    { label: "MV", numeric: true },
    { label: "AVG MH", numeric: true, stat: true },
    { label: "SD MH", numeric: true, stat: true },
    { label: "AVG MV", numeric: true, stat: true },
    { label: "SD MV", numeric: true, stat: true },
  ];

  const headHtml = (columns) => `<tr>${columns.map((column) => `<th scope="col"${column.numeric ? ` class="num"` : ""}>${escapeHtml(column.label)}</th>`).join("")}</tr>`;

  // ผู้ที่ไม่มีสิทธิ์เห็นหน้า "ไม่พบหน้าที่ต้องการ" ข้อความเดียวกับ URL ที่ไม่มีอยู่จริง จึงไม่รู้ว่ามีโมดูลนี้
  function deniedPage() {
    return renderNotFound();
  }

  /* ---------- อ่านข้อมูลสดจากชีต ---------- */

  // คืน feed ที่ผ่าน model.normalizeFeed หรือโยน Error ที่มีรหัส (ข้อความไทยอยู่ที่ errorMessages ด้านล่าง ผ่าน friendlyError)
  async function loadFeed() {
    if (!FEED_URL) throw new Error("LAB_FEED_NOT_CONFIGURED");
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error("AUTH_REQUIRED");
    let response;
    try {
      // text/plain = คำขอแบบง่าย ไม่มี preflight (Apps Script ตอบ OPTIONS ไม่ได้) และไม่ใส่ header อื่น โทเค็นอยู่ใน body เท่านั้น
      // ไม่ใส่ใน URL เพื่อไม่ให้ไปค้างใน log ของเซิร์ฟเวอร์/ประวัติเบราว์เซอร์
      response = await fetch(FEED_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
    } catch {
      throw new Error("LAB_FEED_UNREACHABLE");
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      throw new Error("LAB_FEED_UNREADABLE");
    }
    if (!body?.ok) throw new Error(body?.error === "NOT_AUTHORIZED" ? "NOT_AUTHORIZED" : `LAB_FEED_${body?.error ?? "FAILED"}`);
    return model.normalizeFeed(body);
  }

  const isDenied = (error) => String(error?.message ?? "").includes("NOT_AUTHORIZED");

  // สิทธิ์ถูกถอนหลังเปิดแอปค้างไว้: ปิดเมนูและแสดงหน้า "ไม่พบ" ข้อผิดพลาดอื่นให้ผู้เรียกจัดการ
  function revoke() {
    stopAutoRefresh();
    state.employee.labAccess = false;
    return deniedPage();
  }

  /* ---------- รีเฟรชอัตโนมัติ ---------- */

  // หน้าที่เปิดอยู่หนึ่งหน้าเท่านั้น: update(feed) วาดข้อมูลใหม่ในที่เดิม (ไม่วาดทั้งหน้า ช่องค้นหาจึงไม่หลุดโฟกัส)
  // showStatus(text|null) แสดง/ล้างข้อความสถานะ
  let live = null;

  function stopAutoRefresh() {
    if (live?.timer) window.clearInterval(live.timer);
    live = null;
  }

  async function refreshNow() {
    const current = live;
    if (!current || current.inFlight) return;
    current.inFlight = true;
    current.showStatus("กำลังอัปเดต…");
    try {
      const feed = await loadFeed();
      if (live !== current) return; // ผู้ใช้ย้ายหน้าไปแล้ว
      current.update(feed);
      current.lastAt = Date.now();
      current.showStatus(null);
    } catch (error) {
      if (live !== current) return;
      if (isDenied(error)) return revoke();
      // การอัปเดตรอบหนึ่งล้มเหลว (เน็ตหลุด ชีตช้า) ไม่ล้างข้อมูลที่แสดงอยู่ รอบหน้าลองใหม่เอง
      current.showStatus("อัปเดตไม่สำเร็จ จะลองใหม่อัตโนมัติ — กำลังแสดงข้อมูลชุดล่าสุดที่อ่านได้");
    } finally {
      current.inFlight = false;
    }
  }

  function startAutoRefresh({ update, showStatus }) {
    stopAutoRefresh();
    live = { update, showStatus, inFlight: false, lastAt: Date.now(), timer: null };
    live.timer = window.setInterval(() => {
      // ออกจากโมดูลแล้ว (เปลี่ยน hash) หยุดเอง; แท็บที่ซ่อนอยู่ไม่ยิงคำขอ
      if (!location.hash.startsWith("#/lab")) return stopAutoRefresh();
      if (!document.hidden) refreshNow();
    }, REFRESH_MS);
  }

  window.addEventListener("hashchange", () => {
    if (!location.hash.startsWith("#/lab")) stopAutoRefresh();
  });
  // กลับมาเปิดแท็บนี้ หลังซ่อนไว้นานกว่ารอบรีเฟรช: อ่านใหม่ทันที ไม่รอรอบถัดไป
  document.addEventListener("visibilitychange", () => {
    if (live && !document.hidden && Date.now() - live.lastAt >= REFRESH_MS) refreshNow();
  });

  // ส่วนหัวหน้าที่ใช้ร่วมกัน: เวลาอ่านล่าสุด ปุ่มรีเฟรช ข้อความสถานะ และกล่องเตือนแถวในชีตที่อ่านไม่ได้
  const liveBarHtml = () => `<div class="lab-live">
      <span class="muted small" id="lab-updated">กำลังอ่านชีต…</span>
      <button class="btn secondary small" type="button" id="lab-refresh">รีเฟรชตอนนี้</button>
      <span class="small lab-status" id="lab-status" role="status"></span>
    </div>
    <div class="lab-warning" id="lab-problems" hidden></div>`;

  function bindLiveBar() {
    const updated = document.querySelector("#lab-updated");
    const status = document.querySelector("#lab-status");
    const problems = document.querySelector("#lab-problems");
    document.querySelector("#lab-refresh").addEventListener("click", refreshNow);
    return {
      showStatus: (text) => { status.textContent = text ?? ""; },
      paintMeta(feed) {
        updated.textContent = `อ่านจากชีตล่าสุด ${model.formatUpdatedAt(feed.generatedAt)} · รีเฟรชอัตโนมัติทุก ${REFRESH_MS / 1000} วินาที`;
        // แถวที่อ่านไม่ได้ไม่ถูกแสดง บอก admin ให้ไปแก้ในชีต (ที่เหลือยังแสดงตามปกติ)
        problems.hidden = feed.problemCount === 0;
        problems.innerHTML = feed.problemCount === 0 ? "" : `<strong>พบ ${feed.problemCount.toLocaleString("th-TH")} แถวในชีตที่อ่านไม่ได้ (ไม่แสดงในหน้านี้ — แก้ในชีต)</strong>
          <ul>${feed.problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join("")}</ul>
          ${feed.problemCount > feed.problems.length ? `<span class="small">และอีก ${(feed.problemCount - feed.problems.length).toLocaleString("th-TH")} แถว</span>` : ""}`;
      },
    };
  }

  /* ---------- หน้ารวม: รายการวัสดุ ---------- */

  function materialRowsHtml(materials) {
    return materials.map((item) => `<tr>
      <th scope="row" class="lab-material"><a href="${escapeHtml(model.materialUrl(item.material))}">${escapeHtml(item.material)}</a></th>
      <td class="num">${escapeHtml(model.formatPlain(item.resultCount))}</td>
      <td class="num">${escapeHtml(model.formatPlain(item.testDays))}</td>
      <td class="num">${escapeHtml(model.formatDate(item.firstTested))}</td>
      <td class="num">${escapeHtml(model.formatDate(item.lastTested))}</td>
    </tr>`).join("");
  }

  function statsHtml(summary) {
    const stat = (label, value, note) => `<div class="lab-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`;
    return [
      stat("วัสดุที่ทดสอบ", String(summary.materialCount), "รายการ"),
      stat("ผลทดสอบทั้งหมด", summary.resultCount.toLocaleString("th-TH"), "แถวข้อมูล"),
      stat("ทดสอบล่าสุด", model.formatDate(summary.lastTested), "วันที่ในชีต"),
    ].join("");
  }

  function overviewHtml() {
    const sortOptions = model.SORT_OPTIONS.map((option) => `<option value="${escapeHtml(option.key)}">${escapeHtml(option.label)}</option>`).join("");
    return `<div class="lab-page">
      <div class="page-heading"><div><div class="eyebrow">${escapeHtml(TITLE)}</div><h1>ผลทดสอบ Mooney</h1><p>ข้อมูลสดจากสเปรดชีต Mooney_Test_Report</p></div></div>
      ${liveBarHtml()}
      <section class="lab-stats" id="lab-stats" aria-label="สรุปผลทดสอบ"></section>
      <section class="card flush">
        <div class="card-heading"><h2>วัสดุที่ทดสอบ</h2><span class="muted small" id="lab-count" aria-live="polite"></span></div>
        <div class="lab-toolbar">
          <div class="lab-search"><label class="sr-only" for="lab-search">ค้นหาวัสดุ</label><input class="input" id="lab-search" type="search" enterkeyhint="search" autocomplete="off" maxlength="${model.MAX_MATERIAL_LENGTH}" placeholder="ค้นหาวัสดุ เช่น A1802"></div>
          <div class="lab-sort"><label class="sr-only" for="lab-sort">เรียงตาม</label><select class="select" id="lab-sort">${sortOptions}</select></div>
        </div>
        <div class="table-wrap"><table class="lab-table"><caption class="sr-only">วัสดุที่ทดสอบ Mooney</caption><thead>${headHtml(MATERIAL_COLUMNS)}</thead><tbody id="lab-materials"></tbody></table></div>
        <div class="empty" id="lab-empty" hidden></div>
      </section>
    </div>`;
  }

  // คืน { update(feed), showStatus } — update วาดเฉพาะส่วนที่เปลี่ยน คงข้อความค้นหาและตัวเลือกเรียงของผู้ใช้ไว้
  function bindOverview() {
    const bar = bindLiveBar();
    const search = document.querySelector("#lab-search");
    const sort = document.querySelector("#lab-sort");
    const stats = document.querySelector("#lab-stats");
    const body = document.querySelector("#lab-materials");
    const empty = document.querySelector("#lab-empty");
    const count = document.querySelector("#lab-count");
    let materials = [];
    const paint = () => {
      const query = search.value.trim();
      const shown = model.sortMaterials(model.filterMaterials(materials, query), sort.value);
      stats.innerHTML = statsHtml(model.summarize(materials));
      body.innerHTML = materialRowsHtml(shown);
      empty.hidden = shown.length > 0;
      empty.textContent = materials.length === 0
        ? "ยังไม่มีข้อมูลผลทดสอบในชีต Mooney_Test_Report"
        : `ไม่พบวัสดุที่ตรงกับ “${query}”`;
      count.textContent = query ? `${shown.length} จาก ${materials.length} รายการ` : `${materials.length} รายการ`;
    };
    search.addEventListener("input", paint);
    sort.addEventListener("change", paint);
    return {
      showStatus: bar.showStatus,
      update(feed) {
        materials = model.buildOverview(feed.rows);
        bar.paintMeta(feed);
        paint();
      },
    };
  }

  /* ---------- หน้าวัสดุ: ผลทดสอบทุกแถว ---------- */

  function resultRowHtml(row) {
    return `<tr>
      <th scope="row">${escapeHtml(row.sampleId)}</th>
      <td class="num">${escapeHtml(model.formatDate(row.testDate))}</td>
      <td class="num">${escapeHtml(model.formatTime(row.testTime))}</td>
      <td class="num">${escapeHtml(model.formatPlain(row.temperature))}</td>
      <td class="num">${escapeHtml(model.formatPlain(row.testMinutes))}</td>
      <td class="num">${escapeHtml(model.formatReading(row.mh))}</td>
      <td class="num">${escapeHtml(model.formatReading(row.mv))}</td>
      <td class="num stat">${escapeHtml(model.formatReading(row.avgMh))}</td>
      <td class="num stat">${escapeHtml(model.formatReading(row.sdMh))}</td>
      <td class="num stat">${escapeHtml(model.formatReading(row.avgMv))}</td>
      <td class="num stat">${escapeHtml(model.formatReading(row.sdMv))}</td>
    </tr>`;
  }

  function materialHtml(material) {
    return `<div class="lab-page"><a class="lab-back" href="#/lab">← วัสดุทั้งหมด</a>
      <div class="page-heading"><div><div class="eyebrow">${escapeHtml(TITLE)} · Mooney</div><h1>${escapeHtml(material)}</h1><p id="lab-summary"></p></div></div>
      ${liveBarHtml()}
      <section class="card" id="lab-none" hidden><div class="empty">ไม่พบผลทดสอบของวัสดุ “${escapeHtml(material)}”</div></section>
      <section class="card flush" id="lab-results-card">
        <div class="card-heading"><h2>ผลทดสอบ</h2><span class="muted small">AVG / SD แสดงตามที่ระบุในชีต</span></div>
        <div class="table-wrap"><table class="lab-table"><caption class="sr-only">ผลทดสอบ Mooney ของ ${escapeHtml(material)}</caption><thead>${headHtml(RESULT_COLUMNS)}</thead><tbody id="lab-results"></tbody></table></div>
      </section>
    </div>`;
  }

  function bindMaterial(material) {
    const bar = bindLiveBar();
    const summary = document.querySelector("#lab-summary");
    const none = document.querySelector("#lab-none");
    const card = document.querySelector("#lab-results-card");
    const body = document.querySelector("#lab-results");
    return {
      showStatus: bar.showStatus,
      update(feed) {
        const rows = model.resultsFor(feed.rows, material);
        bar.paintMeta(feed);
        none.hidden = rows.length > 0;
        card.hidden = rows.length === 0;
        const days = new Set(rows.map((row) => row.testDate)).size;
        summary.textContent = rows.length ? `${rows.length.toLocaleString("th-TH")} ผลทดสอบ ใน ${days.toLocaleString("th-TH")} วัน · ใหม่สุดอยู่บนสุด` : "";
        body.innerHTML = rows.map(resultRowHtml).join("");
      },
    };
  }

  /* ---------- เปิดหน้า ---------- */

  async function openPage({ title, html, bind }) {
    stopAutoRefresh();
    loadingShell(PATH, title);
    let feed;
    try {
      feed = await loadFeed();
    } catch (error) {
      if (isDenied(error)) return revoke();
      throw error; // renderRoute แสดงหน้า "โหลดข้อมูลไม่สำเร็จ" พร้อมปุ่มลองอีกครั้ง
    }
    app.innerHTML = shell(html, PATH, title);
    bindShell();
    const view = bind();
    view.update(feed);
    startAutoRefresh(view);
  }

  async function renderLab(params) {
    stopAutoRefresh();
    // เมนูถูกซ่อนเมื่อไม่มีสิทธิ์ แต่พิมพ์ URL เองได้ — ไม่ยิงคำขอใดๆ และไม่บอกว่ามีโมดูลนี้ (Apps Script ปฏิเสธซ้ำอีกชั้นถ้าข้ามมาถึงตรงนี้)
    if (state.employee?.labAccess !== true) return deniedPage();
    const material = model.readMaterial(params.get("material"));
    return material
      ? await openPage({ title: `${TITLE} / ${material}`, html: materialHtml(material), bind: () => bindMaterial(material) })
      : await openPage({ title: TITLE, html: overviewHtml(), bind: bindOverview });
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.MNP_LAB = {
    code: "MNP_LAB",
    enabled: true,
    standalone: true,
    label: TITLE,
    errorMessages: {
      LAB_FEED_NOT_CONFIGURED: "ยังไม่ได้ตั้งค่าที่อยู่ข้อมูลของ MNP LAB",
      LAB_FEED_UNREACHABLE: "เชื่อมต่อชีตไม่ได้ ตรวจอินเทอร์เน็ต หรือตรวจว่า Web App ของ Apps Script deploy แล้วและตั้งเป็น Anyone",
      LAB_FEED_UNREADABLE: "อ่านคำตอบจากชีตไม่ได้ Web App อาจยังเป็นโค้ดเวอร์ชันเก่า ให้ deploy เวอร์ชันใหม่",
      LAB_FEED_AUTH_UNAVAILABLE: "ตรวจสิทธิ์กับระบบไม่ได้ชั่วคราว ลองอีกครั้ง",
      LAB_FEED_BAD_REQUEST: "คำขอข้อมูลไม่ถูกต้อง ลองเข้าสู่ระบบใหม่",
      LAB_FEED_SERVER_ERROR: "อ่านข้อมูลจากชีตไม่สำเร็จ ลองอีกครั้ง",
      LAB_FEED_USE_POST: "Web App ตอบเป็นหน้าทดสอบ ให้ deploy โค้ดเวอร์ชันล่าสุด",
      LAB_FEED_FAILED: "อ่านข้อมูลจากชีตไม่สำเร็จ ลองอีกครั้ง",
    },
    navAllowed: (employee) => employee?.labAccess === true,
    nav: [{ path: PATH, label: TITLE, icon: NAV_ICON }],
    pages: { [PATH]: renderLab },
  };
})();
