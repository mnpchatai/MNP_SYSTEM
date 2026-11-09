// หน้า #/master ของบัญชี master (บัญชีเดียวเหนือผู้ดูแลระบบ) — migration 20261113010000_master_account.sql
//
//   (ว่าง) / tab=errors   ปัญหาที่ผู้ใช้เจอจริง: สรุปปัญหาที่เกิดบ่อย (เลือกช่วงวัน) + รายการล่าสุด (กรองชนิด) โหลดเพิ่มได้
//   tab=activity           บันทึกกิจกรรมทุกโมดูล: กรองประเภท ผู้ทำ ช่วงวันที่ · เฉพาะฟิลด์ที่เปลี่ยน โหลดเพิ่มได้
//
// เมนูโผล่เมื่อ state.employee.isMaster (app_am_i_master) เป็นแค่ UX — ทุก RPC ที่หน้านี้เรียกตรวจ private.is_master()
// เองและปฏิเสธผู้อื่นด้วย NOT_AUTHORIZED ค่ารหัสผ่าน/โทเค็นถูกซ่อนที่ฐานข้อมูลก่อนส่งมา
// ไฟล์นี้โหลดหลัง modules/master-model.js และก่อน app.js เรียก helper ของ app.js (sb, state, app, shell,
// bindShell, loadingShell, escapeHtml, formatDate, friendlyError, emptyState, uiIcon, showToast) ตอนวาดหน้าเท่านั้น
(function registerMasterModule() {
  const model = window.MNP_MASTER_MODEL;
  const PATH = "master";
  const TITLE = "ตรวจระบบ";
  const PAGE_SIZE = 100;
  const SUMMARY_DAYS = [1, 7, 30, 90];
  const NAV_ICON = window.MNP_UI_ICONS?.icon("shield") ?? "";

  const esc = (value) => escapeHtml(value);
  const dash = (value) => (value === null || value === undefined || value === "" ? "—" : value);
  const personLabel = (no, name) => (no || name ? `${name ?? ""}${no ? ` (${no})` : ""}`.trim() : "ระบบ");
  // รหัสแสดงเมื่อไม่ได้อยู่ในข้อความแล้ว (ข้อผิดพลาดจากฐานข้อมูลส่วนใหญ่ข้อความคือรหัสเอง)
  const codeHtml = (code, message) => (code && !String(message ?? "").includes(code) ? `<br><code>${esc(code)}</code>` : "");
  const urlFor = (query = {}) => {
    const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== null && value !== undefined && value !== "")).toString();
    return `#/${PATH}${search ? `?${search}` : ""}`;
  };

  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }

  function paint(content) {
    app.innerHTML = shell(content, PATH, TITLE);
    bindShell();
    return document.querySelector(".content");
  }

  function tabsHtml(tab) {
    return `
      <div class="page-heading"><div><h1>${esc(TITLE)}</h1></div></div>
      <div class="filters" role="navigation" aria-label="ส่วนของหน้าตรวจระบบ">
        <a class="filter${tab === "errors" ? " active" : ""}" href="${urlFor({ tab: "errors" })}"${tab === "errors" ? ' aria-current="page"' : ""}>ปัญหาที่ผู้ใช้เจอ</a>
        <a class="filter${tab === "activity" ? " active" : ""}" href="${urlFor({ tab: "activity" })}"${tab === "activity" ? ' aria-current="page"' : ""}>บันทึกกิจกรรม</a>
      </div>`;
  }

  // ---- ปัญหาที่ผู้ใช้เจอ ---------------------------------------------------------
  function errorRowHtml(row) {
    const detail = [row.detail, row.app_version ? `เวอร์ชันหน้าเว็บ ${row.app_version}` : "", row.user_agent].filter(Boolean).join("\n");
    return `<tr>
      <td class="nowrap">${formatDate(row.created_at, true)}</td>
      <td>${esc(personLabel(row.employee_no, row.employee_name))}${row.is_sandbox ? ` <span class="badge">โหมดทดสอบ</span>` : ""}</td>
      <td>${esc(dash(row.page))}</td>
      <td>${esc(model.errorKindLabel(row.kind))}${codeHtml(row.code, row.message)}</td>
      <td class="master-message">${esc(row.message)}${detail ? `<details class="master-details"><summary>รายละเอียด</summary><pre>${esc(detail)}</pre></details>` : ""}</td>
    </tr>`;
  }

  async function renderErrors(params) {
    const days = SUMMARY_DAYS.includes(Number(params.get("days"))) ? Number(params.get("days")) : 7;
    const kind = Object.hasOwn(model.ERROR_KIND_LABELS, params.get("kind") ?? "") ? params.get("kind") : "";
    const [summary, rows] = await Promise.all([
      rpc("app_master_client_error_summary", { p_days: days }),
      rpc("app_master_client_errors", { p_limit: PAGE_SIZE, p_kind: kind || null }),
    ]);
    const summaryRows = (summary ?? []).map((item) => `<tr>
      <td class="master-message">${esc(item.message)}${codeHtml(item.code, item.message)}</td>
      <td>${esc(model.errorKindLabel(item.kind))}</td>
      <td class="num">${esc(item.occurrences)}</td>
      <td class="num">${esc(item.people)}</td>
      <td>${esc((item.pages ?? []).join(", ") || "—")}</td>
      <td class="nowrap">${formatDate(item.last_at, true)}</td>
    </tr>`).join("");
    const list = rows ?? [];
    const content = `${tabsHtml("errors")}
      <section class="card">
        <div class="master-section-head">
          <h2>เกิดบ่อย</h2>
          <label class="master-inline-field">ช่วง
            <select class="input" id="master-error-days" aria-label="ช่วงเวลาของสรุปปัญหา">
              ${SUMMARY_DAYS.map((value) => `<option value="${value}"${value === days ? " selected" : ""}>${value === 1 ? "24 ชั่วโมง" : `${value} วัน`}</option>`).join("")}
            </select>
          </label>
        </div>
        ${summaryRows ? `<div class="table-wrap"><table>
          <thead><tr><th>ปัญหา</th><th>ชนิด</th><th class="num">ครั้ง</th><th class="num">คน</th><th>หน้า</th><th>ล่าสุด</th></tr></thead>
          <tbody>${summaryRows}</tbody></table></div>` : emptyState("ยังไม่มีผู้ใช้เจอปัญหาในช่วงนี้")}
      </section>
      <section class="card">
        <div class="master-section-head">
          <h2>ล่าสุด</h2>
          <label class="master-inline-field">ชนิด
            <select class="input" id="master-error-kind" aria-label="กรองชนิดของปัญหา">
              <option value="">ทั้งหมด</option>
              ${Object.entries(model.ERROR_KIND_LABELS).map(([code, label]) => `<option value="${esc(code)}"${code === kind ? " selected" : ""}>${esc(label)}</option>`).join("")}
            </select>
          </label>
        </div>
        ${list.length ? `<div class="table-wrap"><table>
          <thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>หน้า</th><th>ชนิด</th><th>ข้อความ</th></tr></thead>
          <tbody id="master-error-rows">${list.map(errorRowHtml).join("")}</tbody></table></div>
          ${moreButtonHtml(list.length)}` : emptyState("ยังไม่มีบันทึกปัญหา")}
      </section>`;
    const root = paint(content);
    root.querySelector("#master-error-days")?.addEventListener("change", (event) => {
      location.hash = urlFor({ tab: "errors", days: event.target.value, kind });
    });
    root.querySelector("#master-error-kind")?.addEventListener("change", (event) => {
      location.hash = urlFor({ tab: "errors", days, kind: event.target.value });
    });
    bindMore(root, list, "#master-error-rows", errorRowHtml, (beforeId) => rpc("app_master_client_errors", {
      p_before_id: beforeId, p_limit: PAGE_SIZE, p_kind: kind || null,
    }));
  }

  // ---- บันทึกกิจกรรม ----------------------------------------------------------------
  function activityRowHtml(row) {
    const lines = model.changeLines(row.action, row.changes);
    const summary = model.changeSummary(row.action, row.changes);
    const target = `${esc(model.entityLabel(row.entity_type))}${row.entity_label ? ` · ${esc(row.entity_label)}` : ""}`;
    const targetHtml = row.request_id ? `<a href="#/request?id=${encodeURIComponent(row.request_id)}">${target}</a>` : target;
    const detail = lines.length ? `<details class="master-details"><summary>${esc(summary || "รายละเอียด")}</summary><dl class="master-changes">${lines.map((line) => `
      <dt>${esc(line.field)}</dt><dd>${"to" in line ? `${esc(line.from)} → ${esc(line.to)}` : esc(line.value)}</dd>`).join("")}</dl></details>` : "";
    return `<tr>
      <td class="nowrap">${formatDate(row.created_at, true)}</td>
      <td>${esc(personLabel(row.actor_no, row.actor_name))}</td>
      <td>${esc(model.actionLabel(row.action))}</td>
      <td>${targetHtml}</td>
      <td class="master-message">${detail}</td>
    </tr>`;
  }

  async function renderActivity(params) {
    const filters = {
      entity: params.get("entity") || "",
      actor: params.get("actor") || "",
      from: model.validDate(params.get("from")) ?? "",
      to: model.validDate(params.get("to")) ?? "",
    };
    const query = () => ({
      p_limit: PAGE_SIZE,
      p_entity_type: filters.entity || null,
      p_actor_id: filters.actor || null,
      p_from: filters.from || null,
      p_to: filters.to || null,
    });
    const [facets, rows] = await Promise.all([
      rpc("app_master_activity_facets"),
      rpc("app_master_activity_log", query()),
    ]);
    const entityOptions = (facets?.entity_types ?? []).map((item) => `<option value="${esc(item.entity_type)}"${item.entity_type === filters.entity ? " selected" : ""}>${esc(model.entityLabel(item.entity_type))} (${esc(item.count)})</option>`).join("");
    const actorOptions = (facets?.actors ?? []).map((item) => `<option value="${esc(item.id)}"${item.id === filters.actor ? " selected" : ""}>${esc(personLabel(item.employee_no, item.name))}</option>`).join("");
    const list = rows ?? [];
    const content = `${tabsHtml("activity")}
      <section class="card">
        <form class="master-filter-grid" id="master-activity-filters">
          <div class="field"><label for="master-entity">ประเภท</label><select class="input" id="master-entity" name="entity"><option value="">ทั้งหมด</option>${entityOptions}</select></div>
          <div class="field"><label for="master-actor">ผู้ทำ</label><select class="input" id="master-actor" name="actor"><option value="">ทุกคน</option>${actorOptions}</select></div>
          <div class="field"><label for="master-from">ตั้งแต่</label><input class="input" id="master-from" name="from" type="date" value="${esc(filters.from)}"></div>
          <div class="field"><label for="master-to">ถึง</label><input class="input" id="master-to" name="to" type="date" value="${esc(filters.to)}"></div>
          <div class="master-filter-actions"><button class="btn secondary" type="submit">กรอง</button>${Object.values(filters).some(Boolean) ? `<a class="btn secondary" href="${urlFor({ tab: "activity" })}">ล้าง</a>` : ""}</div>
        </form>
        ${list.length ? `<div class="table-wrap"><table>
          <thead><tr><th>เวลา</th><th>ผู้ทำ</th><th>การกระทำ</th><th>รายการ</th><th>สิ่งที่เปลี่ยน</th></tr></thead>
          <tbody id="master-activity-rows">${list.map(activityRowHtml).join("")}</tbody></table></div>
          ${moreButtonHtml(list.length)}` : emptyState("ไม่มีกิจกรรมตามตัวกรองนี้")}
      </section>`;
    const root = paint(content);
    root.querySelectorAll('input[type="date"]').forEach((input) => window.MNP_DATE_PICKER?.enhance(input));
    root.querySelector("#master-activity-filters")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      location.hash = urlFor({
        tab: "activity",
        entity: data.get("entity"),
        actor: data.get("actor"),
        from: model.validDate(data.get("from")),
        to: model.validDate(data.get("to")),
      });
    });
    bindMore(root, list, "#master-activity-rows", activityRowHtml, (beforeId) => rpc("app_master_activity_log", { ...query(), p_before_id: beforeId }));
  }

  // ---- โหลดเพิ่ม (เรียงใหม่ไปเก่า ส่ง id ตัวสุดท้ายเป็น p_before_id) -------------------------
  const moreButtonHtml = (count) => (count >= PAGE_SIZE ? `<div class="master-more"><button class="btn secondary" type="button" id="master-more">โหลดเพิ่ม</button></div>` : "");

  function bindMore(root, rows, bodySelector, rowHtml, fetchPage) {
    const button = root.querySelector("#master-more");
    if (!button) return;
    let lastId = rows[rows.length - 1]?.id ?? null;
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        const next = (await fetchPage(lastId)) ?? [];
        root.querySelector(bodySelector)?.insertAdjacentHTML("beforeend", next.map(rowHtml).join(""));
        lastId = next[next.length - 1]?.id ?? lastId;
        if (next.length < PAGE_SIZE) button.closest(".master-more")?.remove();
      } catch (error) {
        showToast(friendlyError(error), "error");
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    });
  }

  async function renderMaster(params) {
    if (!state.employee?.isMaster) return renderNotFound("หน้านี้สำหรับบัญชี master เท่านั้น");
    loadingShell(PATH, TITLE);
    const tab = params.get("tab") === "activity" ? "activity" : "errors";
    try {
      if (tab === "activity") await renderActivity(params);
      else await renderErrors(params);
    } catch (error) {
      console.error(error);
      const message = error?.code === "PGRST202"
        ? "ฐานข้อมูลยังไม่ได้อัปเดตสำหรับหน้าตรวจระบบ กรุณา apply migration ล่าสุดก่อน"
        : friendlyError(error);
      paint(`${tabsHtml(tab)}<section class="card"><div class="empty">${esc(message)}</div></section>`);
    }
    return undefined;
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.MASTER = {
    code: "MASTER",
    enabled: true,
    standalone: true,
    label: TITLE,
    navAllowed: (employee) => employee?.isMaster === true,
    nav: [{ path: PATH, label: TITLE, icon: NAV_ICON }],
    pages: { [PATH]: renderMaster },
  };
})();
