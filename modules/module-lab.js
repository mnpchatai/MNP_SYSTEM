// โมดูล MNP LAB ของ Pilot Web (#/lab) — ห้องปฏิบัติการ เริ่มที่ผลทดสอบ Mooney
//
// ข้อมูลหลักมาจากสเปรดชีต Mooney_Test_Report: Apps Script (apps-script/lab-mooney/Code.gs) ซิงก์ผ่าน Edge Function
// lab-sheet-sync เข้าตาราง lab_mooney_results หน้านี้อ่านจากฐานข้อมูลเท่านั้น ผ่าน RPC ที่ตรวจสิทธิ์ทุกครั้ง
// (20261016020000_mnp_lab_mooney.sql) ไม่อ่านชีตตรงๆ จากเบราว์เซอร์
//
// สิทธิ์: ตอนนี้เฉพาะ admin — ตัดสินที่ฐานข้อมูล (private.can_access_lab) ภายหลังเพิ่มรายชื่อ ID ที่เข้าได้ที่ฟังก์ชันนั้นจุดเดียว
// หน้าเว็บแค่ซ่อนเมนู (navAllowed) และไม่วาดหน้าเมื่อ state.employee.labAccess ไม่เป็น true ซึ่งเป็น UX ไม่ใช่ตัวบังคับสิทธิ์
//
// เป็นโมดูลแยก (standalone: true) ไม่ใช่โมดูลคำร้อง: มีเมนูข้างของตัวเอง ไม่มีการ์ดในหน้าสร้างคำร้อง และยังไม่รองรับโหมดทดสอบ
// (sandbox ไม่ประกาศ จึงถูกซ่อนในโหมดทดสอบ) ไม่มีฝั่ง Next.js เพราะ Pilot Web เป็นหน้าที่ใช้งานจริงตอนนี้
//
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — เรียก helper ของ app.js (state, sb, shell, bindShell, loadingShell,
// renderNotFound, escapeHtml) เฉพาะตอนเปิดหน้า ไม่เรียกตอนโหลดไฟล์
(function registerLabModule() {
  const model = window.MNP_LAB_MOONEY;
  if (!model) return;

  const PATH = "lab";
  const TITLE = "MNP LAB";
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

  // ฐานข้อมูลปฏิเสธ = ไม่มีสิทธิ์จริง (เช่นสิทธิ์ถูกถอนหลังเปิดแอปค้างไว้) ปิดเมนูแล้วบอกผู้ใช้ ข้อผิดพลาดอื่นให้ renderRoute แสดงหน้าลองอีกครั้ง
  function handleFailure(error) {
    if (String(error?.message ?? "").includes("NOT_AUTHORIZED")) {
      state.employee.labAccess = false;
      return deniedPage();
    }
    throw error;
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

  function overviewHtml(overview) {
    const summary = model.summarize(overview.materials);
    const stat = (label, value, note) => `<div class="lab-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`;
    const sortOptions = model.SORT_OPTIONS.map((option) => `<option value="${escapeHtml(option.key)}">${escapeHtml(option.label)}</option>`).join("");
    return `<div class="lab-page">
      <div class="page-heading"><div><div class="eyebrow">${escapeHtml(TITLE)}</div><h1>ผลทดสอบ Mooney</h1><p>ข้อมูลจากสเปรดชีต Mooney_Test_Report · ซิงก์ล่าสุด ${escapeHtml(model.formatSyncedAt(overview.syncedAt))}</p></div></div>
      <section class="lab-stats" aria-label="สรุปผลทดสอบ">
        ${stat("วัสดุที่ทดสอบ", String(summary.materialCount), "รายการ")}
        ${stat("ผลทดสอบทั้งหมด", summary.resultCount.toLocaleString("th-TH"), "แถวข้อมูล")}
        ${stat("ทดสอบล่าสุด", model.formatDate(summary.lastTested), "วันที่ในชีต")}
      </section>
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

  function bindOverview(materials) {
    const search = document.querySelector("#lab-search");
    const sort = document.querySelector("#lab-sort");
    const body = document.querySelector("#lab-materials");
    const empty = document.querySelector("#lab-empty");
    const count = document.querySelector("#lab-count");
    // วาดเฉพาะแถวในตาราง ไม่วาดทั้งหน้า ช่องค้นหาจึงไม่หลุดโฟกัสระหว่างพิมพ์
    const paint = () => {
      const query = search.value.trim();
      const shown = model.sortMaterials(model.filterMaterials(materials, query), sort.value);
      body.innerHTML = materialRowsHtml(shown);
      empty.hidden = shown.length > 0;
      empty.textContent = materials.length === 0
        ? "ยังไม่มีข้อมูลผลทดสอบ ข้อมูลจะปรากฏหลังซิงก์จากสเปรดชีต Mooney_Test_Report ครั้งแรก"
        : `ไม่พบวัสดุที่ตรงกับ “${query}”`;
      count.textContent = query ? `${shown.length} จาก ${materials.length} รายการ` : `${materials.length} รายการ`;
    };
    search.addEventListener("input", paint);
    sort.addEventListener("change", paint);
    paint();
  }

  async function renderOverview() {
    loadingShell(PATH, TITLE);
    const { data, error } = await sb.rpc("app_lab_mooney_overview");
    if (error) return handleFailure(error);
    const overview = model.normalizeOverview(data);
    app.innerHTML = shell(overviewHtml(overview), PATH, TITLE);
    bindShell();
    bindOverview(overview.materials);
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

  function materialHtml(material, rows) {
    const back = `<a class="lab-back" href="#/lab">← วัสดุทั้งหมด</a>`;
    if (!rows.length) {
      return `<div class="lab-page">${back}
        <div class="page-heading"><div><div class="eyebrow">${escapeHtml(TITLE)}</div><h1>${escapeHtml(material)}</h1></div></div>
        <section class="card"><div class="empty">ไม่พบผลทดสอบของวัสดุ “${escapeHtml(material)}”</div></section></div>`;
    }
    const days = new Set(rows.map((row) => row.testDate)).size;
    return `<div class="lab-page">${back}
      <div class="page-heading"><div><div class="eyebrow">${escapeHtml(TITLE)} · Mooney</div><h1>${escapeHtml(material)}</h1><p>${rows.length.toLocaleString("th-TH")} ผลทดสอบ ใน ${days.toLocaleString("th-TH")} วัน · ใหม่สุดอยู่บนสุด</p></div></div>
      <section class="card flush">
        <div class="card-heading"><h2>ผลทดสอบ</h2><span class="muted small">AVG / SD แสดงตามที่ระบุในชีต</span></div>
        <div class="table-wrap"><table class="lab-table"><caption class="sr-only">ผลทดสอบ Mooney ของ ${escapeHtml(material)}</caption><thead>${headHtml(RESULT_COLUMNS)}</thead><tbody>${rows.map(resultRowHtml).join("")}</tbody></table></div>
      </section>
    </div>`;
  }

  async function renderMaterial(material) {
    loadingShell(PATH, `${TITLE} / ${material}`);
    const { data, error } = await sb.rpc("app_lab_mooney_results", { p_material: material });
    if (error) return handleFailure(error);
    app.innerHTML = shell(materialHtml(material, model.normalizeResults(data)), PATH, `${TITLE} / ${material}`);
    bindShell();
  }

  async function renderLab(params) {
    // เมนูถูกซ่อนเมื่อไม่มีสิทธิ์ แต่พิมพ์ URL เองได้ — ไม่วาดหน้า (และฐานข้อมูลปฏิเสธซ้ำอีกชั้นถ้าข้ามมาถึงตรงนี้)
    if (state.employee?.labAccess !== true) return deniedPage();
    const material = model.readMaterial(params.get("material"));
    return material ? await renderMaterial(material) : await renderOverview();
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.MNP_LAB = {
    code: "MNP_LAB",
    enabled: true,
    standalone: true,
    label: TITLE,
    errorMessages: { LAB_INVALID_MATERIAL: "ชื่อวัสดุไม่ถูกต้อง" },
    navAllowed: (employee) => employee?.labAccess === true,
    nav: [{ path: PATH, label: TITLE, icon: NAV_ICON }],
    pages: { [PATH]: renderLab },
  };
})();
