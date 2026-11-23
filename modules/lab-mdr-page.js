// รายงานทดสอบ MDR ของ MNP LAB — การเชื่อมต่อของหน้า (#/lab?module=mdr): อ่านฟีด อัปโหลดไฟล์ .ini วาดกราฟ และผูกเหตุการณ์
// ข้อมูลล้วนที่ lab-mdr-model.js · HTML/SVG ที่ lab-mdr-views.js · module-lab.js ตัดสินสิทธิ์ของหน้า (labAccess) แล้วเรียก open()
//
// สิทธิ์จริงอยู่ที่ RPC: app_lab_mdr_feed และ app_lab_mdr_upload ตรวจ private.can_access_lab ทุกครั้ง (ทุกคนที่เข้า LAB ได้ อ่านและอัปโหลดได้)
// ไม่มีรีเฟรชอัตโนมัติ: ข้อมูลเปลี่ยนเมื่อมีคนอัปโหลดเท่านั้น หน้านี้อ่านใหม่หลังอัปโหลดของตัวเองและทุกครั้งที่เปิดหน้า
// เปลี่ยนสูตร/วันของกราฟ = อ่านใหม่แล้ววาดเฉพาะเนื้อหา และแก้ URL ด้วย replaceState (ผลการอัปโหลดที่แสดงอยู่ไม่หาย)
// ไฟล์นี้โหลดก่อน app.js — เรียก helper ของ app.js (state, sb, app, shell, bindShell, loadingShell, closePopup, friendlyError) เฉพาะตอนเปิดหน้า/ผู้ใช้กด
(function registerLabMdrPage() {
  const model = window.MNP_LAB_MDR;
  const views = window.MNP_LAB_MDR_VIEWS;
  if (!model || !views) return;

  const INVALID_TEST = "ข้อมูลในไฟล์ไม่ผ่านการตรวจของระบบ";
  let version = 0;
  let current = null; // หน้าสูตร/รายการที่วาดอยู่: { route, data, observer, hidden:Set, mine, denied }
  let lastRoute = null;
  // route ล่าสุดที่ขอ (lastRoute: ใช้วาดใหม่หลังอัปโหลด แม้การอ่านครั้งก่อนล้มเหลว) · trendMode = ค่าที่กราฟแนวโน้มของ F2 แสดง (views.TREND_MODES)
  let trendMode = "delta";

  const isDenied = (error) => /NOT_AUTHORIZED|AUTH_REQUIRED|JWT expired/.test(String(error?.message ?? "")) || error?.code === "PGRST301";

  function dispose() {
    current?.observer?.disconnect();
    current = null;
  }
  window.addEventListener("hashchange", () => { version += 1; dispose(); });

  async function loadFeed(route) {
    const employee = state.employee;
    const { data, error } = await sb.rpc("app_lab_mdr_feed", { p_part: route.part, p_formula: route.formula || null, p_date: route.date || null });
    if (error) throw error;
    if (state.employee !== employee) throw new Error("AUTH_REQUIRED");
    if (!data || !Array.isArray(data.formulas) || !Array.isArray(data.tests) || !Array.isArray(data.curves)) throw new Error("LAB_FEED_UNREADABLE");
    return {
      formulas: data.formulas,
      tests: model.normalizeTests(data.tests),
      curveDate: data.curve_date ? String(data.curve_date) : null,
      curves: data.curves.filter((item) => Array.isArray(item?.curve)).map((item) => ({ id: item.id, curve: item.curve.map(Number) })),
    };
  }

  /* ---------- เปิดหน้า ---------- */

  async function open(params, { denied, title, path }) {
    dispose();
    const mine = ++version;
    const route = model.readRoute(params);
    app.innerHTML = shell(views.page(route), path, title);
    bindShell();
    bindUpload(mine, denied);
    await paint(route, mine, denied);
  }

  // อ่านฟีดของ route แล้ววาดเนื้อหา (หัวโมดูล แท็บ และผลการอัปโหลดไม่ถูกวาดใหม่)
  async function paint(route, mine, denied) {
    const body = document.querySelector("#mdr-body");
    if (!body) return;
    lastRoute = route;
    body.setAttribute("aria-busy", "true");
    let data;
    try {
      data = await loadFeed(route);
    } catch (error) {
      if (mine !== version) return;
      if (isDenied(error)) { denied(); return; }
      body.removeAttribute("aria-busy");
      body.innerHTML = `<section class="card">${window.MNP_LAB_SECTIONS.emptyBlock("อ่านผลทดสอบ MDR ไม่สำเร็จ", { hint: friendlyError(error) })}</section>`;
      return;
    }
    if (mine !== version) return;
    current?.observer?.disconnect();
    current = { route, data, observer: null, hidden: new Set(), mine, denied };
    body.removeAttribute("aria-busy");
    body.innerHTML = route.formula ? views.formulaBody(route, data) : views.overview(route.part, data.formulas);
    if (route.formula) bindFormula();
  }

  // เปลี่ยนสูตร/วันในหน้าเดียวกัน: URL ใหม่โดยไม่ผ่าน router (hashchange) แล้ววาดเนื้อหาใหม่
  function goTo(route) {
    const next = model.routeUrl(route);
    if (location.hash !== next) history.replaceState(history.state, "", next);
    // แท็บอีกชุดชี้ไปสูตรเดียวกัน ต้องตามสูตรที่เพิ่งเลือก
    document.querySelectorAll(".lab-mdr-part:not([aria-current])").forEach((link) => { link.href = model.routeUrl({ part: link.dataset.part, formula: route.formula }); });
    const { mine, denied } = current ?? {};
    if (mine === version) void paint(route, mine, denied);
  }

  /* ---------- หน้าสูตร ---------- */

  function bindFormula() {
    const { route, data } = current;
    document.querySelector("#mdr-formula")?.addEventListener("change", (event) => goTo({ part: route.part, formula: event.target.value }));
    document.querySelector("#mdr-date")?.addEventListener("change", (event) => goTo({ ...route, date: event.target.value }));
    document.querySelectorAll("[data-show-date]").forEach((button) => button.addEventListener("click", () => {
      goTo({ ...route, date: button.dataset.showDate });
      document.querySelector("#mdr-plot")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }));
    const trend = document.querySelector("#mdr-trend");
    if (trend) bindTrend(trend, route.part, model.groupByDate(data.tests));
    const plot = document.querySelector("#mdr-plot");
    if (!plot) return;
    const byId = new Map(data.tests.map((test) => [String(test.id), test]));
    const dayTests = model.groupByDate(data.tests).find((day) => day.date === data.curveDate)?.tests ?? [];
    const colors = views.colorMap(dayTests, data.curves);
    const series = data.curves.filter((item) => colors.has(String(item.id))).map((item) => ({ id: String(item.id), color: colors.get(String(item.id)), curve: item.curve, t90: byId.get(String(item.id))?.t90_s ?? null, machineId: byId.get(String(item.id))?.machine_id ?? "" }));
    bindChart(plot, series);
  }

  // กราฟแนวโน้มรายวันของ F2: ปุ่ม MH−ML / t90 สลับค่าในกราฟเดียว โหมดที่เลือกคงไว้เมื่อเปลี่ยนสูตร (trendMode) · วาดใหม่เมื่อความกว้างเปลี่ยน
  function bindTrend(plot, partKey, days) {
    const buttons = [...document.querySelectorAll("[data-trend]")];
    let width = 0;
    const note = document.querySelector("#mdr-trend-note");
    const baseLabel = plot.getAttribute("aria-label");
    function draw(force = false) {
      // สถานะปุ่มก่อน: แม้กราฟยังวาดไม่ได้ (กว้าง 0 เช่นแท็บซ่อน) ปุ่มก็ตรงกับค่าที่เลือก
      buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.trend === trendMode)));
      const next = Math.floor(plot.clientWidth - 36);
      if (next <= 0 || (next === width && !force)) return;
      width = next;
      const chart = views.trendSvg(days, trendMode, width, partKey);
      plot.innerHTML = chart.svg;
      if (note) note.textContent = chart.note;
      const mode = views.TREND_MODES.find((item) => item.key === trendMode);
      plot.setAttribute("aria-label", `${baseLabel} ค่า ${mode?.label ?? ""} รายครั้งและค่าเฉลี่ยรายวัน`);
    }
    buttons.forEach((button) => button.addEventListener("click", () => {
      trendMode = button.dataset.trend;
      draw(true);
    }));
    draw(true);
    if (typeof ResizeObserver === "function") {
      current.observer = new ResizeObserver(() => draw());
      current.observer.observe(plot);
    }
  }

  function bindChart(plot, series) {
    const tip = document.querySelector("#mdr-tip");
    const legend = document.querySelector("#mdr-legend");
    let geometry = null;
    let cursor = null; // วินาทีที่ชี้อยู่
    let width = 0;

    function draw() {
      const next = Math.floor(plot.clientWidth - 36); // ตรงกับ padding ซ้ายขวา 18px ของ .lab-plot
      if (next <= 0 || next === width) return;
      width = next;
      const chart = views.chartSvg(series, width);
      geometry = chart.geometry;
      plot.innerHTML = chart.svg;
      applyVisibility();
      if (cursor !== null) showAt(cursor);
    }

    function applyVisibility() {
      plot.querySelectorAll(".lab-mdr-line").forEach((line) => line.classList.toggle("is-off", current.hidden.has(line.dataset.test)));
    }

    function showAt(second) {
      if (!geometry) return;
      cursor = Math.max(0, Math.min(geometry.seconds, Math.round(second)));
      const px = geometry.left + (cursor / geometry.seconds) * geometry.plotW;
      // ป้ายแสดง t90 ของทุกครั้งที่แสดงอยู่ (ไม่ใช่แรงบิด ณ วินาทีที่ชี้) ตำแหน่งที่ชี้ใช้แค่วางป้ายข้างเมาส์
      const rows = series.filter((item) => !current.hidden.has(item.id))
        .map((item) => ({ color: item.color, machineId: item.machineId, t90: item.t90 }));
      if (!rows.length) { tip.hidden = true; return; } // ซ่อนทุกเส้นแล้ว: ไม่มีอะไรให้แสดง
      tip.innerHTML = views.tipHtml(rows);
      tip.hidden = false;
      const left = px + 18 + 14; // 18 = padding ของกราฟ
      const room = plot.clientWidth - tip.offsetWidth - 8;
      tip.style.left = `${Math.max(4, left > room ? px + 18 - tip.offsetWidth - 14 : left)}px`;
      tip.style.top = "12px";
    }

    function hide() {
      cursor = null;
      tip.hidden = true;
    }

    const secondAt = (event) => {
      const box = plot.querySelector("svg")?.getBoundingClientRect();
      if (!box || !geometry) return null;
      const x = ((event.clientX - box.left) / box.width) * geometry.width;
      return ((x - geometry.left) / geometry.plotW) * geometry.seconds;
    };
    plot.addEventListener("pointermove", (event) => { const second = secondAt(event); if (second !== null) showAt(second); });
    plot.addEventListener("pointerleave", (event) => { if (event.pointerType === "mouse") hide(); });
    plot.addEventListener("keydown", (event) => {
      const moves = { ArrowRight: 10, ArrowLeft: -10, PageUp: 60, PageDown: -60 };
      if (event.key in moves) showAt((cursor ?? 0) + moves[event.key]);
      else if (event.key === "Home") showAt(0);
      else if (event.key === "End") showAt(geometry?.seconds ?? 0);
      else if (event.key === "Escape") hide();
      else return;
      event.preventDefault();
    });
    plot.addEventListener("blur", hide);

    legend?.querySelectorAll(".lab-mdr-key").forEach((key) => {
      const id = key.dataset.test;
      key.addEventListener("click", () => {
        const on = key.getAttribute("aria-pressed") !== "true";
        key.setAttribute("aria-pressed", String(on));
        if (on) current.hidden.delete(id); else current.hidden.add(id);
        applyVisibility();
        if (cursor !== null) showAt(cursor);
      });
      const hot = (on) => {
        plot.classList.toggle("is-focus", on);
        plot.querySelector(`.lab-mdr-line[data-test="${CSS.escape(id)}"]`)?.classList.toggle("is-hot", on);
      };
      key.addEventListener("pointerenter", () => hot(true));
      key.addEventListener("pointerleave", () => hot(false));
      key.addEventListener("focus", () => hot(true));
      key.addEventListener("blur", () => hot(false));
    });

    draw();
    if (typeof ResizeObserver === "function") {
      current.observer = new ResizeObserver(() => draw());
      current.observer.observe(plot);
    }
  }

  /* ---------- อัปโหลด ---------- */

  function bindUpload(mine, denied) {
    const button = document.querySelector("#mdr-upload");
    const menu = document.querySelector("#mdr-upload-menu");
    const inputs = { files: document.querySelector("#mdr-pick-files"), folder: document.querySelector("#mdr-pick-folder") };
    if (!button || !menu) return;
    button.addEventListener("click", () => {
      if (!menu.hidden) { closePopup(menu); return; }
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      menu.querySelector("button")?.focus();
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { closePopup(menu); button.focus(); }
    });
    menu.querySelectorAll("[data-pick]").forEach((item) => item.addEventListener("click", () => {
      closePopup(menu);
      const input = inputs[item.dataset.pick];
      input.value = "";
      input.click();
    }));
    Object.values(inputs).forEach((input) => input?.addEventListener("change", () => {
      const files = [...(input.files ?? [])];
      if (files.length) void upload(files, mine, denied, button);
    }));
  }

  async function readFiles(files) {
    return Promise.all(files.map(async (file) => {
      const readable = /\.ini$/i.test(file.name) && file.size <= model.MAX_FILE_BYTES;
      return { name: file.webkitRelativePath || file.name, size: file.size, text: readable ? await file.text() : null };
    }));
  }

  // ส่งทีละชุดแยกตามชุดทดสอบ (นับเพิ่มใหม่ต่อชุดได้ตรง) · รายการที่ฐานข้อมูลปฏิเสธถูกย้ายไป "ข้าม" แล้วส่งชุดนั้นใหม่โดยไม่มีมัน
  async function upload(files, mine, denied, button) {
    const result = document.querySelector("#mdr-result");
    button.disabled = true;
    result.hidden = false;
    result.innerHTML = views.uploadProgress(0, files.length);
    const summary = { added: { F1: 0, F2: 0 }, duplicates: 0, skipped: [], failed: null };
    let done = 0;
    let accepted = [];
    let skipped = [];
    try {
      // อ่านไฟล์อยู่ในตัวจับ error ด้วย: อ่านจากไดรฟ์แชร์ไม่ได้ (เครือข่ายหลุด ไฟล์ถูกย้าย) ต้องบอกผู้ใช้ ไม่ค้างที่ "กำลังอัปโหลด"
      ({ accepted, skipped } = model.classifyFiles(await readFiles(files)));
      for (const part of model.PARTS) {
        for (const batch of model.chunk(accepted.filter((item) => item.part === part.key))) {
          let pending = batch;
          while (pending.length) {
            if (mine !== version) return;
            const { data, error } = await sb.rpc("app_lab_mdr_upload", { p_tests: pending.map((item) => item.test) });
            if (error && /LAB_MDR_INVALID_TEST/.test(String(error.message ?? "")) && Number(error.details) >= 1 && Number(error.details) <= pending.length) {
              const bad = pending[Number(error.details) - 1];
              skipped.push({ file: bad.file, reason: INVALID_TEST });
              pending = pending.filter((item) => item !== bad);
              continue;
            }
            if (error) throw error;
            summary.added[part.key] += Number(data?.inserted ?? 0);
            summary.duplicates += Number(data?.duplicates ?? 0);
            done += pending.length;
            if (mine === version) result.innerHTML = views.uploadProgress(done, accepted.length);
            pending = [];
          }
        }
      }
    } catch (error) {
      if (mine !== version) return;
      if (isDenied(error)) { denied(); return; }
      summary.failed = accepted.length || skipped.length
        ? `อัปโหลดไม่สำเร็จ ${accepted.length - done} ครั้ง: ${friendlyError(error)} — เลือกไฟล์ชุดเดิมอีกครั้งได้ ผลที่บันทึกแล้วจะไม่ซ้ำ`
        : `อ่านไฟล์ที่เลือกไม่สำเร็จ (${files.length} ไฟล์): ${friendlyError(error)} — ตรวจว่ายังเปิดโฟลเดอร์ได้ แล้วเลือกใหม่อีกครั้ง`;
    }
    if (mine !== version) return;
    summary.skipped = model.groupSkipped(skipped);
    button.disabled = false;
    result.innerHTML = views.uploadResult(summary);
    result.querySelector("#mdr-result-close")?.addEventListener("click", () => { result.hidden = true; result.innerHTML = ""; });
    if (summary.added.F1 + summary.added.F2 > 0 && lastRoute) await paint(lastRoute, mine, denied);
  }

  window.MNP_LAB_MDR_PAGE = { open };
})();
