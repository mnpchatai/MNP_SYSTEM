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
  const rangeKit = window.MNP_LAB_RANGE;
  if (!model || !views || !rangeKit) return;

  const INVALID_TEST = "ข้อมูลในไฟล์ไม่ผ่านการตรวจของระบบ";
  let version = 0;
  let current = null; // หน้าสูตร/รายการที่วาดอยู่: { route, data, observer, hidden:Set, mine, denied }
  let lastRoute = null;
  // route ล่าสุดที่ขอ (lastRoute: ใช้วาดใหม่หลังอัปโหลด แม้การอ่านครั้งก่อนล้มเหลว) · trendMode = ค่าที่ผู้ใช้เลือกให้กราฟแนวโน้มแสดง (views.TREND_MODES)
  let trendMode = "delta";
  // ช่วงวันของกราฟแนวโน้มและตาราง (views.trendRange) คงไว้เมื่อวาดสูตรเดิมใหม่ (เปลี่ยนวันของกราฟแรงบิด หลังอัปโหลด) เปลี่ยนสูตร/ชุดทดสอบ = เริ่มที่ล่าสุดใหม่
  let trendZoom = { kind: "latest" };
  let zoomOwner = "";

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
    zoomOwner = ""; // เปิดหน้าใหม่ (ไม่ใช่ goTo ในหน้าเดิม) = ช่วงเริ่มที่ล่าสุดเสมอ
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
    const owner = `${route.part}|${route.formula}`;
    if (owner !== zoomOwner) {
      zoomOwner = owner;
      trendZoom = { kind: "latest" };
    }
    body.innerHTML = route.formula ? views.formulaBody(route, data, trendZoom) : views.overview(route.part, data.formulas);
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
    // ปุ่ม "ดูกราฟ" ในตาราง: ผูกที่กล่องตาราง เพราะตารางถูกวาดใหม่เมื่อช่วงวันเปลี่ยน
    document.querySelector("#mdr-table-scroll")?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-show-date]");
      if (!button) return;
      goTo({ ...route, date: button.dataset.showDate });
      document.querySelector("#mdr-plot")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    const days = model.groupByDate(data.tests);
    const observers = [];
    const trend = document.querySelector("#mdr-trend");
    if (trend) observers.push(bindTrend(trend, route.part, days, data.curveDate));
    const plot = document.querySelector("#mdr-plot");
    if (plot) observers.push(bindChart(plot, curveSeries(data, days)));
    // ResizeObserver ตัวเดียวต่อหน้า ดูทั้งสองกราฟ (dispose ตัดทิ้งเมื่อออกจากหน้า)
    const draws = observers.filter(Boolean);
    if (draws.length && typeof ResizeObserver === "function") {
      current.observer = new ResizeObserver(() => draws.forEach((entry) => entry.draw()));
      draws.forEach((entry) => current.observer.observe(entry.plot));
    }
  }

  // เส้นแรงบิดของวันที่เลือก (F1): สีตามลำดับในตาราง
  function curveSeries(data, days) {
    const byId = new Map(data.tests.map((test) => [String(test.id), test]));
    const dayTests = days.find((day) => day.date === data.curveDate)?.tests ?? [];
    const colors = views.colorMap(dayTests, data.curves);
    return data.curves.filter((item) => colors.has(String(item.id))).map((item) => ({ id: String(item.id), color: colors.get(String(item.id)), curve: item.curve, t90: byId.get(String(item.id))?.t90_s ?? null, machineId: byId.get(String(item.id))?.machine_id ?? "" }));
  }

  // กราฟแนวโน้มรายวัน (F1 และ F2): ปุ่มค่าสลับค่าในกราฟเดียว โหมดที่เลือกคงไว้เมื่อเปลี่ยนสูตร (trendMode) ถ้าสูตรนั้นมีค่านั้น
  // แถบช่วงวัน (lab-range.js เหมือนกราฟ Mooney): ล่าสุด 30 วัน / ทั้งหมด / เดือน … ถึง … / เลื่อน ‹ › / ซูม − + ช่วงที่เลือกกำหนดทั้งวันที่วาดและแถวในตาราง
  // ปุ่มและ <select> เป็นของเบราว์เซอร์ทั้งหมด (ไม่มี popup ของแอป) จึงใช้ได้ทั้งเมาส์ แป้นพิมพ์ และการแตะบน iPhone
  function bindTrend(plot, partKey, days, curveDate) {
    const buttons = [...document.querySelectorAll("[data-trend]")];
    const modes = buttons.map((button) => button.dataset.trend);
    // ค่าที่ผู้ใช้เลือก (trendMode) ไม่ถูกเขียนทับ: สูตรที่ไม่มีค่านั้น (เช่น ts2 ของ F2) แสดงค่าแรกแทนชั่วคราว
    const shownMode = () => (modes.includes(trendMode) ? trendMode : modes[0] ?? "delta");
    const note = document.querySelector("#mdr-trend-note");
    const bar = document.querySelector("#mdr-zoom");
    const monthFrom = document.querySelector("#mdr-month-from");
    const monthTo = document.querySelector("#mdr-month-to");
    const announcer = document.querySelector("#mdr-range-announce");
    const table = document.querySelector("#mdr-table-scroll");
    const baseLabel = plot.getAttribute("aria-label");
    const total = days.length;
    const months = [...new Set(days.map((day) => rangeKit.monthOf(day.date)).filter(Boolean))].sort();
    let width = 0;
    let shown = views.trendRange(trendZoom, days); // ช่วงที่ตารางแสดงอยู่ (formulaBody วาดด้วยช่วงเดียวกัน)
    let monthsPainted = false;

    function paintBar(now) {
      if (!bar) return;
      bar.hidden = total === 0;
      bar.querySelectorAll("[data-range]").forEach((button) => button.setAttribute("aria-pressed", String(trendZoom.kind === button.dataset.range)));
      const first = rangeKit.monthOf(days[total - 1 - now.start]?.date);
      const last = rangeKit.monthOf(days[total - now.end]?.date);
      // วาดตัวเลือกเดือนครั้งเดียวต่อหน้า ไม่วาดทุกครั้งที่เลื่อน (ไม่ปิดตัวเลือกของระบบที่เปิดค้างอยู่)
      if (monthFrom && monthTo && !monthsPainted) {
        monthsPainted = true;
        monthFrom.innerHTML = rangeKit.monthOptions(months, first, views.formatMonth);
        monthTo.innerHTML = rangeKit.monthOptions(months, last, views.formatMonth);
      }
      if (monthFrom) monthFrom.value = first ?? "";
      if (monthTo) monthTo.value = last ?? "";
      const limits = rangeKit.limits(now, total, views.TREND_MIN_DAYS);
      bar.querySelectorAll("[data-step]").forEach((button) => { button.disabled = limits[button.dataset.step]; });
    }

    function draw(force = false) {
      // สถานะปุ่มก่อน: แม้กราฟยังวาดไม่ได้ (กว้าง 0 เช่นแท็บซ่อน) ปุ่มก็ตรงกับค่าที่เลือก
      buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.trend === shownMode())));
      const now = views.trendRange(trendZoom, days);
      paintBar(now);
      if (table && !rangeKit.same(now, shown)) {
        shown = now;
        table.innerHTML = views.resultsTable(partKey, views.rangeDays(days, now), curveDate);
        table.scrollTop = 0;
      }
      const next = Math.floor(plot.clientWidth - 36);
      if (next <= 0 || (next === width && !force)) return;
      width = next;
      const chart = views.trendSvg(days, shownMode(), width, partKey, now);
      plot.innerHTML = chart.svg;
      if (note) note.textContent = chart.note;
      const mode = views.TREND_MODES.find((item) => item.key === shownMode());
      plot.setAttribute("aria-label", `${baseLabel} ค่า ${mode?.label ?? ""} รายครั้งและค่าเฉลี่ยรายวัน`);
    }

    const announce = () => { if (announcer) announcer.textContent = views.rangeAnnouncement(days, views.trendRange(trendZoom, days)); };

    // ซูม/เลื่อนมาเอง: ติดขอบขวา (วันล่าสุด) อยู่ = ขยับตามเมื่อมีวันใหม่เข้ามา
    function setRange(next) {
      const now = views.trendRange(trendZoom, days);
      const normal = rangeKit.normalize(next, total, views.TREND_MIN_DAYS);
      if (rangeKit.same(normal, now)) return;
      trendZoom = { kind: "custom", start: normal.start, end: normal.end, follow: normal.end >= total };
      draw(true);
    }

    buttons.forEach((button) => button.addEventListener("click", () => {
      trendMode = button.dataset.trend;
      draw(true);
    }));

    bar?.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      const now = views.trendRange(trendZoom, days);
      const min = views.TREND_MIN_DAYS;
      if (button.dataset.range) {
        trendZoom = { kind: button.dataset.range };
        draw(true);
      // ซูมด้วยปุ่ม: ช่วงที่ติดวันล่าสุดซูมโดยตรึงขอบขวา (ยังเห็นวันล่าสุด) นอกนั้นตรึงกลางกราฟ
      } else if (button.dataset.step === "in") setRange(rangeKit.zoom(now, total, 2, now.end >= total ? 1 : 0.5, min));
      else if (button.dataset.step === "out") setRange(rangeKit.zoom(now, total, 0.5, now.end >= total ? 1 : 0.5, min));
      else if (button.dataset.step === "back") setRange(rangeKit.pan(now, total, rangeKit.panStep(now, -0.5), min));
      else if (button.dataset.step === "forward") setRange(rangeKit.pan(now, total, rangeKit.panStep(now, 0.5), min));
      else return;
      announce();
    });

    // เลือกเดือน: ทุกวันของเดือนแรกถึงเดือนสุดท้ายที่เลือก (รวมทั้งสองเดือน) เดือนเริ่มหลังเดือนจบ = อีกช่องย้ายตามมา
    bar?.addEventListener("change", (event) => {
      if (event.target !== monthFrom && event.target !== monthTo) return;
      const picked = rangeKit.pickMonths(monthFrom.value, monthTo.value, event.target === monthFrom ? "from" : "to");
      trendZoom = { kind: "months", ...picked };
      draw(true);
      announce();
    });

    draw(true);
    return { plot, draw: () => draw() };
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
    return { plot, draw };
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
