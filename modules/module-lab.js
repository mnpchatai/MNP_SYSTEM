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
// ไฟล์นี้ดูแลเฉพาะการเชื่อมต่อ: อ่านฟีด สิทธิ์ รีเฟรชอัตโนมัติ และผูกเหตุการณ์ของหน้า ส่วนข้อมูลล้วนอยู่ที่ lab-mooney-model.js
// กราฟ SVG ที่ lab-mooney-chart.js และ HTML ของหน้า/ตารางที่ lab-mooney-views.js (โหลดก่อนไฟล์นี้ ดู index.html)
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — เรียก helper ของ app.js (state, sb, app, shell, bindShell, loadingShell,
// renderNotFound) เฉพาะตอนเปิดหน้า ไม่เรียกตอนโหลดไฟล์
(function registerLabModule() {
  const model = window.MNP_LAB_MOONEY;
  const views = window.MNP_LAB_VIEWS;
  const chart = window.MNP_LAB_CHART;
  if (!model || !views || !chart) return;

  const PATH = "lab";
  const TITLE = "MNP LAB";
  // Web App ที่ deploy จาก apps-script/lab-mooney/Code.gs (Execute as: Me, Who has access: Anyone) — URL นี้ไม่ใช่ความลับ
  // เพราะ Web App คืนข้อมูลเฉพาะเมื่อมีโทเค็นของผู้มีสิทธิ์ ว่าง = ยังไม่ตั้งค่า
  const FEED_URL = "https://script.google.com/macros/s/AKfycbyorWZ40Rkt9YCoN4M1YvOTV3vlmLVjRv7rk9gxjGzzFnJApzZ2zHiMnGKE6Vu7zgWO/exec";
  const REFRESH_MS = 30 * 1000;
  const NAV_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9V3"/><path d="M7.5 15h9"/></svg>`;

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

  // หน้าที่เปิดอยู่หนึ่งหน้าเท่านั้น: update(feed) วาดข้อมูลใหม่ในที่เดิม (ไม่วาดทั้งหน้า ช่องค้นหาและตัวกรองจึงไม่หลุด)
  // showStatus(text|null) แสดง/ล้างข้อความสถานะ, setBusy(bool) หมุนไอคอนรีเฟรช, dispose() ปล่อยตัวสังเกตขนาดเมื่อออกจากหน้า
  let live = null;

  function stopAutoRefresh() {
    if (live?.timer) window.clearInterval(live.timer);
    live?.dispose?.();
    live = null;
  }

  async function refreshNow() {
    const current = live;
    if (!current || current.inFlight) return;
    current.inFlight = true;
    current.setBusy(true);
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
      current.setBusy(false);
    }
  }

  function startAutoRefresh({ update, showStatus, setBusy, dispose }) {
    stopAutoRefresh();
    live = { update, showStatus, setBusy, dispose, inFlight: false, lastAt: Date.now(), timer: null };
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

  // ผูกแถบเวลาอ่านล่าสุด/ปุ่มรีเฟรช/กล่องเตือนของหน้า คืนตัวแสดงผลที่ทั้งสองหน้าใช้ร่วมกัน
  function bindLiveBar() {
    const updated = document.querySelector("#lab-updated");
    const status = document.querySelector("#lab-status");
    const problems = document.querySelector("#lab-problems");
    const refresh = document.querySelector("#lab-refresh");
    refresh.addEventListener("click", refreshNow);
    return {
      showStatus: (text) => { status.textContent = text ?? ""; },
      setBusy(busy) {
        refresh.classList.toggle("is-loading", busy);
        refresh.setAttribute("aria-busy", String(busy));
      },
      paintMeta(feed) {
        updated.textContent = `อ่านจากชีตล่าสุด ${model.formatUpdatedAt(feed.generatedAt)}`;
        // แถวที่อ่านไม่ได้ไม่ถูกแสดง บอก admin ให้ไปแก้ในชีต (ที่เหลือยังแสดงตามปกติ)
        problems.hidden = feed.problemCount === 0;
        problems.innerHTML = views.problemsHtml(feed);
      },
    };
  }

  /* ---------- หน้ารวม: รายการวัสดุ ---------- */

  // คืน { update(feed), showStatus, setBusy } — update วาดเฉพาะส่วนที่เปลี่ยน คงข้อความค้นหาและตัวเลือกเรียงของผู้ใช้ไว้
  function bindOverview() {
    const bar = bindLiveBar();
    const search = document.querySelector("#lab-search");
    const sort = document.querySelector("#lab-sort");
    const summaryText = document.querySelector("#lab-summary");
    const body = document.querySelector("#lab-materials");
    const empty = document.querySelector("#lab-empty");
    const count = document.querySelector("#lab-count");
    let materials = [];
    const paint = () => {
      const query = search.value.trim();
      const shown = model.sortMaterials(model.filterMaterials(materials, query), sort.value);
      summaryText.textContent = views.overviewSummaryText(model.summarize(materials));
      body.innerHTML = views.materialRows(shown, model.todayInBangkok());
      empty.hidden = shown.length > 0;
      empty.textContent = materials.length === 0
        ? "ยังไม่มีข้อมูลผลทดสอบในชีต Mooney_Test_Report"
        : `ไม่พบวัสดุที่ตรงกับ “${query}”`;
      count.textContent = query ? `${shown.length} จาก ${materials.length} รายการ` : `${materials.length} รายการ`;
    };
    search.addEventListener("input", paint);
    sort.addEventListener("change", paint);
    // กดที่ไหนในแถวก็เข้าหน้าวัสดุได้ (ลิงก์ชื่อวัสดุยังเป็นลิงก์จริงสำหรับคีย์บอร์ดและเปิดแท็บใหม่)
    body.addEventListener("click", (event) => {
      if (event.target.closest("a") || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const href = event.target.closest("tr")?.dataset.href;
      if (href?.startsWith("#/lab")) location.hash = href;
    });
    return {
      showStatus: bar.showStatus,
      setBusy: bar.setBusy,
      update(feed) {
        materials = model.buildMaterialSummaries(feed.rows);
        bar.paintMeta(feed);
        paint();
      },
    };
  }

  /* ---------- หน้าวัสดุ: กราฟ MH/MV และตารางผลทดสอบ ---------- */

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  function bindMaterial(material) {
    const bar = bindLiveBar();
    const el = {
      summary: document.querySelector("#lab-summary"),
      none: document.querySelector("#lab-none"),
      body: document.querySelector("#lab-body"),
      materialSelect: document.querySelector("#lab-material-select"),
      idSelect: document.querySelector("#lab-id-select"),
      orderSelect: document.querySelector("#lab-order-select"),
      chartTitle: document.querySelector("#lab-chart-title"),
      readout: document.querySelector("#lab-readout"),
      plot: document.querySelector("#lab-plot"),
      key: document.querySelector("#lab-chart-key"),
      announce: document.querySelector("#lab-announce"),
      tableTitle: document.querySelector("#lab-table-title"),
      tableNote: document.querySelector("#lab-table-note"),
      scroll: document.querySelector("#lab-table-scroll"),
      copy: document.querySelector("#lab-copy"),
    };

    // ข้อมูลของหน้า: series = ผลทั้งวัสดุตามลำดับในชีต, shown = สิ่งที่กราฟ/ตารางแสดงอยู่ (ทั้งวัสดุ หรือเฉพาะ ID ที่เลือก)
    const data = { summaries: [], series: null, ids: [], conditions: null, shown: { mode: "sequence", items: [] }, signature: "", plotWidth: 0, plot: null };
    // ตัวเลือกของผู้ใช้ที่ต้องคงไว้ตอนรีเฟรช: ID, ลำดับตาราง และจุดที่เลือกไว้ (เก็บเป็น id ของแถว ไม่ใช่ตำแหน่ง เพราะตำแหน่งขยับเมื่อมีแถวใหม่)
    const view = { id: "", order: "newest", pinnedId: null, preview: null };
    let applied = "";

    const itemsOf = () => data.shown.items;

    function resolveFocus() {
      const items = itemsOf();
      if (view.preview !== null && view.preview < items.length) return { index: view.preview, kind: "preview" };
      const pinned = view.pinnedId === null ? -1 : items.findIndex((item) => item.id === view.pinnedId);
      if (pinned >= 0) return { index: pinned, kind: "pinned" };
      return { index: items.length - 1, kind: "latest" };
    }

    // เลื่อนกล่องตารางให้แถวที่เลือกอยู่กลางกล่องเมื่อแถวนั้นพ้นสายตา (เห็นทั้งชุดทดสอบรอบข้าง) เลื่อนเฉพาะในกล่อง ไม่ดึงทั้งหน้า
    function revealRow(row) {
      const box = el.scroll;
      const boxRect = box.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const visibleTop = boxRect.top + (box.querySelector("thead")?.getBoundingClientRect().height ?? 0);
      if (rowRect.top >= visibleTop && rowRect.bottom <= boxRect.bottom) return;
      box.scrollTop += rowRect.top + rowRect.height / 2 - (visibleTop + (boxRect.bottom - visibleTop) / 2);
    }

    // วาดสถานะ "จุดที่ดูอยู่" ใหม่ทั้งหมด: เส้นนำสายตา วงรอบจุด แถวในตาราง และแถบแสดงค่า (ล่าสุด → กำลังชี้ → เลือกไว้)
    function applyFocus({ reveal = false, announce = false } = {}) {
      const items = itemsOf();
      if (!items.length) {
        el.readout.innerHTML = "";
        return;
      }
      const { index, kind } = resolveFocus();
      const item = items[index];
      const signature = `${index}|${kind}|${item.id}`;
      if (signature !== applied || reveal) {
        applied = signature;
        el.readout.innerHTML = views.readout({ item, group: data.shown.mode === "sequence" ? data.series.groups[item.groupIndex] : null, kind, mode: data.shown.mode });
        const x = data.plot ? data.plot.xAt(index) : null;
        el.plot.querySelectorAll(".lab-cross").forEach((line) => {
          if (x === null) return;
          line.setAttribute("x1", String(x));
          line.setAttribute("x2", String(x));
          line.setAttribute("visibility", "visible");
        });
        el.plot.querySelectorAll(".lab-pt.is-active").forEach((node) => node.classList.remove("is-active"));
        el.plot.querySelectorAll(`.lab-pt[data-i="${index}"]`).forEach((node) => node.classList.add("is-active"));
        el.scroll.querySelectorAll("tr.is-active").forEach((row) => row.classList.remove("is-active"));
        const row = el.scroll.querySelector(`tr[data-seq="${item.seq}"]`);
        row?.classList.add("is-active");
        if (reveal && row) revealRow(row);
      }
      if (announce) el.announce.textContent = `${data.shown.mode === "id" ? `ครั้งที่ ${item.order}` : `ลำดับ ${item.seq}`} ID ${item.sampleId} MH ${model.formatReading(item.mh)} MV ${model.formatReading(item.mv)}`;
    }

    function paintChart() {
      const width = Math.floor(el.plot.clientWidth);
      if (!width) return;
      data.plotWidth = width;
      const items = itemsOf();
      data.plot = chart.trendChart({ mode: data.shown.mode, items, groups: data.shown.mode === "sequence" ? data.series.groups : [], width, label: material });
      el.plot.innerHTML = data.plot.html;
      applied = "";
      applyFocus();
    }

    function paintTable({ resetScroll = false } = {}) {
      const top = el.scroll.scrollTop;
      const uniform = data.conditions.uniform;
      const activeItem = itemsOf()[resolveFocus().index];
      const activeSeq = activeItem ? activeItem.seq : null;
      el.scroll.innerHTML = data.shown.mode === "id"
        ? views.idTable({ rows: data.shown.items, order: view.order, uniform, activeSeq, id: view.id })
        : views.resultsTable({ series: data.series, order: view.order, uniform, activeSeq });
      el.scroll.scrollTop = resetScroll ? 0 : top;
      el.tableNote.textContent = data.shown.mode === "id"
        ? `Δ = ผลต่างจากครั้งก่อนหน้าของ ID เดียวกัน · ${view.order === "newest" ? "ใหม่สุดก่อน" : "เก่าสุดก่อน"}`
        : `ชุดเดียวกันใช้ AVG / SD ร่วมกัน · ${view.order === "newest" ? "ใหม่สุดก่อน" : "เก่าสุดก่อน"}`;
    }

    function computeShown() {
      if (view.id && data.ids.some((entry) => entry.id === view.id)) data.shown = { mode: "id", items: model.idSeries(data.series.items, view.id) };
      else {
        view.id = "";
        data.shown = { mode: "sequence", items: data.series.items };
      }
      el.chartTitle.textContent = data.shown.mode === "id"
        ? `ID ${view.id} · ${data.shown.items.length.toLocaleString("th-TH")} ครั้ง ตามลำดับการทดสอบ`
        : "แนวโน้ม MH / MV ตามลำดับการทดสอบ";
      el.tableTitle.textContent = data.shown.mode === "id" ? `ผลทดสอบของ ID ${view.id}` : "ผลทดสอบ";
      el.key.innerHTML = views.chartKey(data.shown.mode);
    }

    function paintAll() {
      computeShown();
      el.summary.textContent = views.materialSummaryText(data.series, data.conditions);
      el.materialSelect.innerHTML = views.materialOptions(data.summaries, material);
      el.idSelect.innerHTML = views.idOptions(data.ids, view.id, data.series.items.length);
      el.idSelect.value = view.id;
      el.orderSelect.value = view.order;
      paintTable();
      paintChart();
    }

    /* ----- การโต้ตอบ ----- */

    const indexFromPointer = (event) => {
      const svg = el.plot.querySelector("svg");
      if (!svg || !data.plot) return -1;
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return -1;
      return data.plot.indexAt(((event.clientX - rect.left) * data.plotWidth) / rect.width);
    };

    const preview = (index) => {
      if (index < 0 || view.preview === index) return;
      view.preview = index;
      applyFocus();
    };
    const clearPreview = () => {
      if (view.preview === null) return;
      view.preview = null;
      applyFocus();
    };
    const pin = (index, { toggle = false } = {}) => {
      const item = itemsOf()[index];
      if (!item) return;
      view.pinnedId = toggle && view.pinnedId === item.id ? null : item.id;
      view.preview = null;
      applyFocus({ reveal: true, announce: true });
    };

    let pressed = false;
    // เมาส์: ชี้ = ดูค่า คลิก = ปักหมุด (คลิกซ้ำเพื่อปล่อย) / นิ้วและปากกา: แตะหรือลากเพื่อดูค่า ปล่อยนิ้วแล้วปักหมุดจุดสุดท้าย
    el.plot.addEventListener("pointermove", (event) => {
      if (event.pointerType === "mouse" || pressed) preview(indexFromPointer(event));
    });
    el.plot.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      pressed = true;
      if (event.pointerType !== "mouse") preview(indexFromPointer(event));
    });
    el.plot.addEventListener("pointerup", (event) => {
      const wasPressed = pressed;
      pressed = false;
      if (!wasPressed) return;
      const index = indexFromPointer(event);
      if (index < 0) return;
      pin(index, { toggle: event.pointerType === "mouse" });
    });
    const leave = () => {
      pressed = false;
      clearPreview();
    };
    el.plot.addEventListener("pointerleave", leave);
    el.plot.addEventListener("pointercancel", leave);
    el.plot.addEventListener("keydown", (event) => {
      const items = itemsOf();
      if (!items.length) return;
      const { index } = resolveFocus();
      const target = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: items.length - 1 }[event.key];
      if (event.key === "Escape") {
        view.pinnedId = null;
        view.preview = null;
        applyFocus({ announce: true });
      } else if (target !== undefined) {
        pin(clamp(target, 0, items.length - 1));
      } else return;
      event.preventDefault();
    });

    // ตาราง: ชี้แถว = ดูค่าของครั้งนั้นบนกราฟ คลิก/แตะแถว = ปักหมุด
    const indexOfRow = (row) => {
      const seq = Number(row?.dataset.seq);
      return Number.isFinite(seq) ? itemsOf().findIndex((item) => item.seq === seq) : -1;
    };
    el.scroll.addEventListener("mouseover", (event) => {
      const index = indexOfRow(event.target.closest("tr"));
      if (index >= 0) preview(index);
    });
    el.scroll.addEventListener("mouseleave", clearPreview);
    el.scroll.addEventListener("click", (event) => {
      const index = indexOfRow(event.target.closest("tr"));
      if (index >= 0) {
        view.preview = null;
        view.pinnedId = view.pinnedId === itemsOf()[index].id ? null : itemsOf()[index].id;
        applyFocus({ announce: true });
      }
    });

    el.materialSelect.addEventListener("change", () => {
      location.hash = model.materialUrl(el.materialSelect.value);
    });
    el.idSelect.addEventListener("change", () => {
      view.id = el.idSelect.value;
      view.pinnedId = null;
      view.preview = null;
      computeShown();
      paintTable({ resetScroll: true });
      paintChart();
    });
    el.orderSelect.addEventListener("change", () => {
      view.order = el.orderSelect.value === "oldest" ? "oldest" : "newest";
      paintTable({ resetScroll: true });
      applied = "";
      applyFocus({ reveal: view.pinnedId !== null });
    });

    let copyTimer = 0;
    el.copy.addEventListener("click", async () => {
      const uniform = data.conditions.uniform;
      const text = data.shown.mode === "id"
        ? views.idTsv({ rows: data.shown.items, order: view.order, uniform })
        : views.resultsTsv({ series: data.series, order: view.order, uniform });
      let label = "คัดลอกแล้ว";
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        label = "คัดลอกไม่ได้ ลองเลือกตารางแล้วกด Ctrl+C";
      }
      el.copy.textContent = label;
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => { el.copy.textContent = "คัดลอกตาราง"; }, 2200);
    });

    // กราฟกว้างตามกล่อง: วาดใหม่เมื่อความกว้างเปลี่ยน (หมุนจอ ย่อ/ขยายหน้าต่าง เปิด/ปิดเมนูข้าง)
    let frame = 0;
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
        if (!data.series || Math.abs(Math.floor(el.plot.clientWidth) - data.plotWidth) < 2) return;
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(paintChart);
      })
      : null;
    observer?.observe(el.plot);

    return {
      showStatus: bar.showStatus,
      setBusy: bar.setBusy,
      dispose() {
        observer?.disconnect();
        window.cancelAnimationFrame(frame);
        window.clearTimeout(copyTimer);
      },
      update(feed) {
        bar.paintMeta(feed);
        const rows = feed.rows.filter((row) => row.material === material);
        el.none.hidden = rows.length > 0;
        el.body.hidden = rows.length === 0;
        if (!rows.length) {
          el.summary.textContent = "";
          data.series = null;
          data.signature = "";
          return;
        }
        const signature = model.feedSignature(rows);
        // ชีตไม่เปลี่ยนจากรอบก่อน: ไม่วาดใหม่ (ไม่กระพริบ ไม่เสียจุดที่ผู้ใช้ชี้อยู่)
        if (data.series && signature === data.signature) return;
        data.signature = signature;
        data.summaries = model.buildMaterialSummaries(feed.rows);
        data.series = model.buildSeries(feed.rows, material);
        data.ids = model.idsFor(data.series.items);
        data.conditions = model.testConditions(data.series.items);
        paintAll();
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
      ? await openPage({ title: `${TITLE} / ${material}`, html: views.materialPage(material, REFRESH_MS / 1000), bind: () => bindMaterial(material) })
      : await openPage({ title: TITLE, html: views.overviewPage(REFRESH_MS / 1000), bind: bindOverview });
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
