// RubberFlow — หน้าแผนก RB ขึ้นรูปยาง (#/factory?dept=RB) ของโมดูลฝ่ายโรงงาน (โหมดทดสอบ)
//
// ย้ายโครงหน้าสถานีของต้นแบบ prototypes/rubber-mes (ผสมยาง → ขึ้นรูป → อบ → ตัดและตกแต่ง) มาเป็นหน้าหลักของแผนก RB
// บนใบงานผลิตจริง: ตัวเลขสรุปของสาย RB · แถบ 4 สถานีพร้อมจำนวนงานที่ถึงคิว (&st=<สถานี> เลือกสถานี) · ฟอร์มทำขั้นตอนของใบงาน
// ที่เลือกในหน้าสถานี (&jb=<id> ใช้ฟอร์มและการผูก event เดียวกับหน้าใบงาน รวมช่องกรอกค่าพารามิเตอร์/กักกันอัตโนมัติ) ·
// ตารางใบงานที่สถานี (นาฬิกาพักยางของขั้นพัก) · ใบงานที่ส่งต่อแผนกถัดไปแล้ว · ทางลัดสูตรยาง/Routing/SPC
// การจัดขั้นเข้าสถานีอยู่ที่ modules/factory-rb-flow-model.js กฎจริงอยู่ที่ RPC ของฐานข้อมูล (ซ่อน/แสดงปุ่มไม่ใช่การควบคุมสิทธิ์)
// module-factory.js เรียก view "department:RB" ก่อน view "department" ทั่วไป แผนกอื่นยังใช้คิวแบบเดิม
//
// โหลดหลัง modules/module-factory-job.js (ใช้ window.MNP_FACTORY_JOB_UI) และก่อน modules/module-factory.js
// ฟังก์ชันของ app.js (state, escapeHtml, formatDate) เรียกได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
// ทุกลิงก์/แท็บเป็น <a> ธรรมดา ไม่มี popup ลอย จึงไม่ต้องมีโค้ดปิด popup
(function registerFactoryRbView() {
  const flow = window.MNP_FACTORY_RB_FLOW;
  const model = window.MNP_FACTORY_JOB_MODEL;
  const menu = window.MNP_FACTORY_ITEM_MASTER;
  const { loadData, notice, fold } = window.MNP_FACTORY_UI;
  const jobUi = window.MNP_FACTORY_JOB_UI;

  const q4 = (value) => Number(value ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 4 });
  const dept = () => state.employee?.department?.code ?? null;
  const byId = (rows, id) => (rows ?? []).find((row) => row.id === id) ?? null;
  const tile = (title, value, hint) => `<div class="summary"><span>${escapeHtml(title)}</span><strong>${escapeHtml(value)}</strong><small>${hint}</small></div>`;
  const jobLink = (job) => `<a class="fm-item-link" href="${escapeHtml(jobUi.viewUrl(job.id))}"><strong>${escapeHtml(job.code)}</strong><span>${escapeHtml(job.production_code)}</span></a>`;
  const itemCell = (job) => `<strong>${escapeHtml(job.item_code)}</strong><br><span class="muted small">${escapeHtml(job.item_name)}</span>`;

  function summaryHtml(summary) {
    const yieldText = summary.yieldPercent === null ? "ยังไม่มีใบที่เสร็จ" : `ผลิตจริง/สั่ง ${summary.yieldPercent.toLocaleString("en-US")}%`;
    return `<div class="summary-grid fm-summary rbf-summary">
        ${tile("ใบงานในสาย RB", summary.active, "ยังมีขั้นของ RB รอทำ")}
        ${tile("ถูกกักกัน รอ QA", summary.held, summary.held ? "ค่าหลุดสเปก ทำต่อไม่ได้จนกว่า QA ตัดสิน" : "ไม่มีใบที่ถูกกักกัน")}
        ${tile("ส่งต่อแผนกถัดไปแล้ว", summary.handed, "ขั้นของ RB เสร็จหมด รอ SR / QC")}
        ${tile("เสร็จแล้ว", summary.completed, escapeHtml(yieldText))}
      </div>`;
  }

  // แถบสถานี: ลิงก์ไป &st= ของสถานีนั้น ตัวเลขใหญ่ = ถึงคิว ป้ายเล็ก = ถูกกักกัน (ไม่นับรวมกัน)
  function stationsHtml(board, current) {
    const items = board.stations.map((station, index) => {
      const active = station.stage === current.stage;
      const total = station.ready.length + station.held.length;
      return `<li><a class="rbf-station${active ? " is-active" : ""}${total ? " has-work" : ""}" href="${escapeHtml(flow.url({ st: station.stage }))}"${active ? ' aria-current="page"' : ""}>
          <span class="rbf-station-no">${index + 1}</span>
          <span class="rbf-station-copy"><strong>${escapeHtml(station.label)}</strong><small>${escapeHtml(station.hint)}</small></span>
          <span class="rbf-station-count" aria-label="ถึงคิว ${station.ready.length} ใบ">${station.ready.length}</span>
          ${station.held.length ? `<span class="badge cancelled rbf-station-held">กักกัน ${station.held.length}</span>` : ""}
        </a></li>`;
    }).join("");
    return `<ol class="rbf-stations" aria-label="สถานีของสาย RB">${items}</ol>`;
  }

  function restCell(entry) {
    if (!entry.rest) return "";
    const text = flow.remainingText(entry.rest.remainingMs);
    return `<br><span class="rbf-rest${entry.rest.remainingMs > 0 ? " is-resting" : ""}" title="ครบกำหนด ${escapeHtml(formatDate(entry.rest.readyAt, true))}">⏱ ${escapeHtml(text)}</span>`;
  }

  function stationRows(entries, station, openId) {
    return entries.map((entry) => {
      const { job, step, held, progress } = entry;
      const action = held
        ? `<span class="badge cancelled">กักกัน รอ QA</span> <a class="btn secondary small" href="${escapeHtml(jobUi.viewUrl(job.id))}">เปิด</a>`
        : `<a class="btn${job.id === openId ? " secondary" : ""} small" href="${escapeHtml(flow.url({ st: station.stage, jb: job.id }))}" aria-label="ทำขั้นตอนของ ${escapeHtml(job.code)}">${job.id === openId ? "เปิดอยู่" : "ทำขั้นตอน"}</a>`;
      return `<tr${job.id === openId ? ' class="is-open"' : ""}>
        <td>${jobLink(job)}</td>
        <td>${itemCell(job)}</td>
        <td class="right">${q4(job.qty)} ${escapeHtml(job.unit_code)}</td>
        <td>${escapeHtml(step.name)}${held ? `<br><span class="muted small fm-pre">${escapeHtml(job.hold_reason ?? "")}</span>` : restCell(entry)}</td>
        <td class="right"><span class="muted small">${progress.done}/${progress.total} ขั้น</span></td>
        <td class="right">${action}</td>
      </tr>`;
    }).join("");
  }

  function stationHtml(station, index, openId) {
    const entries = [...station.held, ...station.ready];
    const table = entries.length
      ? `<div class="table-wrap"><table><thead><tr><th>ใบงาน</th><th>ผลิต</th><th class="right">จำนวน</th><th>ขั้นที่ถึงคิว</th><th class="right">RB</th><th class="right">จัดการ</th></tr></thead><tbody>${stationRows(entries, station, openId)}</tbody></table></div>`
      : `<div class="empty">ไม่มีใบงานที่สถานี${escapeHtml(station.label)}</div>`;
    return `<section class="card rbf-station-card"><h2>สถานีที่ ${index + 1} · ${escapeHtml(station.label)} <span class="muted small">(${station.ready.length})</span></h2>
        <p class="muted small">ใบงานที่ขั้นถัดไปอยู่ในสถานีนี้ เก่าสุดก่อน — กด “ทำขั้นตอน” เพื่อเปิดฟอร์มในหน้านี้ (ต้องสลับ “ทำหน้าที่เป็น” เป็นพนักงานแผนก RB)</p>${table}</section>`;
  }

  // ฟอร์มทำขั้นตอนของใบงานที่เลือก (ฟอร์มเดียวกับหน้าใบงาน) — ใบที่ไม่อยู่ในสาย RB แล้วบอกว่าไปอยู่ที่ไหน
  function openJobHtml(data, job, board, station) {
    const next = model.nextStep(job);
    const where = board.stations.find((row) => [...row.ready, ...row.held].some((entry) => entry.job.id === job.id));
    const full = `<a class="btn secondary small" href="${escapeHtml(jobUi.viewUrl(job.id))}">เปิดใบงานเต็ม</a>`;
    let body;
    if (!next) body = notice(`${job.code} ${model.JOB_STATUSES[job.status] ?? job.status} — ไม่มีขั้นให้ทำแล้ว`);
    else if (!where) body = notice(`${job.code} อยู่ที่ขั้น “${next.name}” ของแผนก ${next.department_code} ไม่ได้อยู่ในสถานีของ RB ตอนนี้`);
    else if (where.stage !== station.stage) body = `<p class="fm-notice" role="note">${escapeHtml(`${job.code} อยู่ที่สถานี${where.label}`)} — <a href="${escapeHtml(flow.url({ st: where.stage, jb: job.id }))}">ไปที่สถานี${escapeHtml(where.label)}</a></p>`;
    else body = `<p class="fm-current-step"><strong>${escapeHtml(next.name)}</strong> · ${escapeHtml(job.item_code)} ${escapeHtml(job.item_name)} · ${q4(job.qty)} ${escapeHtml(job.unit_code)}</p>${jobUi.actionsHtml(data, job)}`;
    return `<section class="card rbf-open"><div class="rbf-open-head"><h2>${jobLink(job)}</h2>${full}</div>${body}</section>`;
  }

  function handedHtml(board) {
    const rows = (entries) => `<div class="table-wrap"><table><thead><tr><th>ใบงาน</th><th>ผลิต</th><th>ตอนนี้อยู่ที่ขั้น</th><th class="right">จัดการ</th></tr></thead><tbody>${entries.map(({ job, step }) => `<tr>
        <td>${jobLink(job)}</td><td>${itemCell(job)}</td><td>${escapeHtml(step.name)}<br><span class="muted small">(แผนก ${escapeHtml(step.department_code)})</span></td>
        <td class="right"><a class="btn secondary small" href="${escapeHtml(jobUi.viewUrl(job.id))}">เปิด</a></td></tr>`).join("")}</tbody></table></div>`;
    const parts = [];
    if (board.waiting.length) parts.push(fold(`รอแผนกอื่นก่อน แล้วกลับมาที่ RB <span class="muted small">(${board.waiting.length})</span>`, rows(board.waiting), { open: true, tone: "warn" }));
    parts.push(board.handed.length
      ? fold(`ส่งต่อแผนกถัดไปแล้ว <span class="muted small">(${board.handed.length})</span>`, rows(board.handed))
      : fold("ส่งต่อแผนกถัดไปแล้ว <span class=\"muted small\">(0)</span>", '<div class="empty">ยังไม่มีใบงานที่ส่งต่อ</div>'));
    return `<section class="card rbf-handed">${parts.join("")}</section>`;
  }

  const linksHtml = () => `<section class="card"><h2>เครื่องมือของสาย RB</h2><div class="fm-actions">
      <a class="btn secondary" href="${escapeHtml(menu.url("structure-view"))}">สูตรยาง (BOM)</a>
      <a class="btn secondary" href="${escapeHtml(menu.url("routing-view"))}">ขั้นตอนและพารามิเตอร์ (Routing)</a>
      <a class="btn secondary" href="${escapeHtml(menu.url("quality-spc"))}">SPC / Cpk</a>
      <a class="btn secondary" href="${escapeHtml(menu.url("job-view"))}">ใบงานผลิตทั้งหมด</a>
    </div></section>`;

  const VIEWS = {
    async [`department:${flow.DEPARTMENT}`]({ params, frame }) {
      frame.loading();
      const data = await loadData();
      const board = flow.board(data.jobs, Date.now());
      const station = flow.pickStation(board.stations, params.get("st"));
      const index = board.stations.indexOf(station);
      const job = params.get("jb") ? byId(data.jobs, params.get("jb")) : null;
      const open = params.get("jb") && !job ? `<section class="card">${notice("ไม่พบใบงานนี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)")}</section>` : job ? openJobHtml(data, job, board, station) : "";
      const root = frame.paint({ body: `<p class="rbf-brand">RubberFlow · สายผลิตยาง 4 สถานี${dept() === flow.DEPARTMENT ? "" : ` · <span class="muted">ตอนนี้ทำหน้าที่เป็นแผนก ${escapeHtml(dept() ?? "—")}</span>`}</p>
        ${summaryHtml(board.summary)}${stationsHtml(board, station)}${open}${stationHtml(station, index, job?.id ?? null)}${handedHtml(board)}${linksHtml()}` });
      if (job) jobUi.bindDetail(root, job);
      return root;
    },
  };

  Object.assign(window.MNP_FACTORY_VIEWS, VIEWS);
})();
