// โมดูล MNP LAB ของ Pilot Web (#/lab) — ห้องปฏิบัติการ มี 4 โมดูล: แดชบอร์ด · เปรียบเทียบเคมี · Mooney test report · MDR test report
// (รายการ ลำดับ สี และ URL ของโมดูลอยู่ที่ lab-sections.js) #/lab เป็นหน้าเลือกโมดูลแบบการ์ดสีเหมือนหน้าคำร้อง (ไม่เรียกฐานข้อมูล)
// ตอนนี้มีข้อมูลเฉพาะ Mooney: แดชบอร์ดสรุปจากฟีดเดียวกัน ส่วนเปรียบเทียบเคมีและ MDR ยังไม่มีแหล่งข้อมูล
// จึงแสดงว่ายังไม่เปิดใช้งานและไม่เรียกข้อมูลใด ๆ
//
// Google Sheets เป็นข้อมูลต้นทาง; Apps Script ซิงก์เข้า Supabase ทุกนาทีผ่าน lab-sheet-sync
// หน้าเว็บอ่านเฉพาะสรุป/วัสดุที่เลือกผ่าน RPC ที่ตรวจสิทธิ์ และตรวจข้อมูลใหม่ทุก 30 วินาที
//
// สิทธิ์: RPC app_lab_mooney_feed ตรวจ private.can_access_lab ทุกครั้งก่อนคืนข้อมูล
// หน้าเว็บแค่ซ่อนเมนู (navAllowed) และไม่วาดหน้าเมื่อ state.employee.labAccess ไม่เป็น true ซึ่งเป็น UX ไม่ใช่ตัวบังคับสิทธิ์
// ผู้ที่ไม่มีสิทธิ์เห็นหน้า "ไม่พบหน้าที่ต้องการ" เหมือน URL ที่ไม่มีอยู่จริง และไม่มีคำขอไป Apps Script
//
// เป็นโมดูลแยก (standalone: true) ไม่ใช่โมดูลคำร้อง: มีเมนูข้างของตัวเอง ไม่มีการ์ดในหน้าสร้างคำร้อง และยังไม่รองรับโหมดทดสอบ
// (sandbox ไม่ประกาศ จึงถูกซ่อนในโหมดทดสอบ) ไม่มีฝั่ง Next.js เพราะ Pilot Web เป็นหน้าที่ใช้งานจริงตอนนี้
//
// ไฟล์นี้ดูแลเฉพาะการเชื่อมต่อ: อ่านฟีด สิทธิ์ รีเฟรชอัตโนมัติ และผูกเหตุการณ์ของหน้า ส่วนข้อมูลล้วนอยู่ที่ lab-mooney-model.js
// กราฟ SVG ที่ lab-mooney-chart.js และ HTML ของหน้า/ตารางที่ lab-mooney-views.js (โหลดก่อนไฟล์นี้ ดู index.html)
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — เรียก helper ของ app.js (state, sb, app, shell, bindShell, loadingShell,
// renderNotFound, closePopup) เฉพาะตอนเปิดหน้า/ตอนผู้ใช้กด ไม่เรียกตอนโหลดไฟล์
(function registerLabModule() {
  const model = window.MNP_LAB_MOONEY;
  const views = window.MNP_LAB_VIEWS;
  const chart = window.MNP_LAB_CHART;
  const sections = window.MNP_LAB_SECTIONS;
  if (!model || !views || !chart || !sections) return;

  const PATH = "lab";
  const TITLE = "MNP LAB";
  const REFRESH_MS = 30 * 1000;
  const NAV_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9V3"/><path d="M7.5 15h9"/></svg>`;

  // ผู้ที่ไม่มีสิทธิ์เห็นหน้า "ไม่พบหน้าที่ต้องการ" ข้อความเดียวกับ URL ที่ไม่มีอยู่จริง จึงไม่รู้ว่ามีโมดูลนี้
  function deniedPage() {
    return renderNotFound();
  }

  /* ---------- อ่านจากฐานข้อมูล + แคชเฉพาะบัญชีในหน่วยความจำ ---------- */
  let cache = new Map();
  let owner = null;
  let authBound = false;
  let pageVersion = 0;

  function clearCache() { cache = new Map(); owner = null; pageVersion += 1; }

  function bindCacheOwner() {
    if (!authBound) {
      sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") { stopAutoRefresh(); clearCache(); }
      });
      authBound = true;
    }
    if (owner !== state.employee) { clearCache(); owner = state.employee; }
  }

  async function loadFeed(material) {
    const employee = state.employee;
    const { data, error } = await sb.rpc("app_lab_mooney_feed", { p_material: material || null });
    if (error) throw error;
    if (state.employee !== employee || employee !== owner) throw new Error("AUTH_REQUIRED");
    if (!data || !Array.isArray(data.materials) || !Array.isArray(data.rows)) throw new Error("LAB_FEED_UNREADABLE");
    const feed = { ...model.normalizeFeed(data), materials: data.materials };
    const key = material || "";
    cache.delete(key);
    cache.set(key, feed);
    // Bound retained material data; never persist it in localStorage or IndexedDB.
    if (cache.size > 6) cache.delete(cache.keys().next().value);
    return feed;
  }

  const isDenied = (error) => /NOT_AUTHORIZED|AUTH_REQUIRED|JWT expired/.test(String(error?.message ?? "")) || error?.code === "PGRST301";

  // สิทธิ์ถูกถอนหลังเปิดแอปค้างไว้: ปิดเมนูและแสดงหน้า "ไม่พบ" ข้อผิดพลาดอื่นให้ผู้เรียกจัดการ
  function revoke() {
    stopAutoRefresh();
    clearCache();
    if (state.employee) state.employee.labAccess = false;
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
    if (!current || current.inFlight || state.employee !== current.employee) return;
    current.inFlight = true;
    current.setBusy(true);
    current.showStatus("กำลังอัปเดต…");
    try {
      const feed = await loadFeed(current.material);
      if (live !== current) return; // ผู้ใช้ย้ายหน้าไปแล้ว
      current.update(feed);
      current.lastAt = Date.now();
      current.showStatus(feedStatus(feed));
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

  function startAutoRefresh({ update, showStatus, setBusy, dispose }, material) {
    stopAutoRefresh();
    live = { update, showStatus, setBusy, dispose, material, employee: state.employee, inFlight: false, lastAt: Date.now(), timer: null };
    live.timer = window.setInterval(() => {
      // ออกจากโมดูลแล้ว (เปลี่ยน hash) หยุดเอง; แท็บที่ซ่อนอยู่ไม่ยิงคำขอ
      if (!location.hash.startsWith("#/lab") || state.employee !== live?.employee) return stopAutoRefresh();
      if (!document.hidden) refreshNow();
    }, REFRESH_MS);
  }

  window.addEventListener("hashchange", () => {
    pageVersion += 1;
    stopAutoRefresh();
  });
  // กลับมาเปิดแท็บนี้ หลังซ่อนไว้นานกว่ารอบรีเฟรช: อ่านใหม่ทันที ไม่รอรอบถัดไป
  document.addEventListener("visibilitychange", () => {
    if (live && !document.hidden && Date.now() - live.lastAt >= REFRESH_MS) refreshNow();
  });

  // ผูกแถบเวลาอ่านล่าสุดกับปุ่มรีเฟรชของหน้า คืนตัวแสดงผลที่ทั้งสองหน้าใช้ร่วมกัน
  function feedStatus(feed) {
    return Date.now() - Date.parse(feed.generatedAt) > 3 * 60 * 1000
      ? "ข้อมูลจากชีตยังไม่อัปเดต — กำลังแสดงชุดที่ซิงก์สำเร็จล่าสุด" : null;
  }

  function bindLiveBar() {
    const updated = document.querySelector("#lab-updated");
    const status = document.querySelector("#lab-status");
    const refresh = document.querySelector("#lab-refresh");
    refresh.addEventListener("click", refreshNow);
    return {
      showStatus: (text) => { status.textContent = text ?? ""; },
      setBusy(busy) {
        refresh.classList.toggle("is-loading", busy);
        refresh.setAttribute("aria-busy", String(busy));
      },
      paintMeta(feed) {
        updated.textContent = `ข้อมูลชีต ${model.formatUpdatedAt(feed.generatedAt)}`;
      },
    };
  }

  /* ---------- แดชบอร์ด: สรุปจากฟีดหน้ารวม (คำขอและแคชเดียวกับรายการวัสดุ) ---------- */
  // สรุปที่มี health (ตัวซิงก์รุ่นใหม่) = แดชบอร์ด 4 ส่วน (วันล่าสุด · กราฟเล็กต่อสูตร · แผนที่ความร้อน · เจาะลึก) จาก views.dashboardBody
  // สรุปรุ่นก่อน (ยังไม่ redeploy ตัวซิงก์) = ตัวเลขชุดเดิม จึงเผยแพร่เว็บก่อนหรือหลังตัวซิงก์ก็ได้
  // ช่วงวัน ค่า MV/MH และสูตรที่เลือก คงไว้ตอนรีเฟรช ทุกส่วนวาดใหม่เฉพาะเมื่อ HTML เปลี่ยน
  // (#app เป็น aria-live โปรแกรมอ่านหน้าจอจะได้ไม่อ่านเนื้อหาเดิมซ้ำทุกรอบรีเฟรช) การเลือกสูตรสลับ aria-pressed บนปุ่มเดิม โฟกัสคีย์บอร์ดไม่หลุด

  function bindDashboard() {
    const bar = bindLiveBar();
    const mooney = document.querySelector("#lab-dash-mooney");
    // picked = ผู้ใช้กดเลือกสูตรเอง (คงไว้) · ไม่ได้เลือก = สูตรแรกของรายการแนวโน้ม (ต้องดูก่อนสุด) เปลี่ยนตามข้อมูลใหม่
    const view = { mode: "", key: "mv", days: model.DASH_DEFAULT_DAYS, material: null, picked: false, materials: [], trend: [], today: "", plotWidth: 0, trendWidth: 0 };
    const painted = new Map();
    const paintInto = (selector, html) => {
      if (painted.get(selector) === html) return;
      const node = mooney.querySelector(selector);
      if (!node) return;
      painted.set(selector, html);
      node.innerHTML = html;
    };
    const field = (id) => mooney.querySelector(id);

    // ความกว้างของกราฟเล็กหนึ่งใบ จากความกว้างของกริด (ต้องตรงกับ .lab-trends / .lab-trend ใน styles.css: ช่องอย่างน้อย 215px ช่องว่าง 10px ขอบ+padding 22px)
    const TREND_MIN = 215;
    const TREND_GAP = 10;
    const TREND_PAD = 22;
    function trendWidth() {
      const total = Math.floor(field("#lab-trends")?.clientWidth || 0);
      if (!total) return 240;
      const columns = Math.max(1, Math.floor((total + TREND_GAP) / (TREND_MIN + TREND_GAP)));
      return Math.max(160, Math.floor((total - TREND_GAP * (columns - 1)) / columns) - TREND_PAD);
    }

    // สูตรที่เลือกบนปุ่มเดิมทุกส่วน (การ์ด กราฟเล็ก ชื่อในแผนที่ความร้อน รายการต้องดูก่อน) ไม่วาดใหม่
    function paintSelection() {
      mooney.querySelectorAll("[data-material]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.material === view.material)));
    }

    function paintControl() {
      const item = view.materials.find((entry) => entry.material === view.material) ?? null;
      mooney.querySelectorAll("[data-measure]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.measure === view.key)));
      field("#lab-control-name").textContent = view.material ?? "";
      field("#lab-control-note").textContent = item ? views.controlNote(item.health?.[view.key], view.key) : "";
      const link = field("#lab-control-link");
      link.hidden = !view.material;
      if (view.material) link.href = model.materialUrl(view.material);
      const plot = field("#lab-control-plot");
      view.plotWidth = Math.floor(plot.clientWidth);
      paintInto("#lab-control-plot", view.material
        ? views.controlPlot({ control: item?.health?.[view.key], key: view.key, width: view.plotWidth, material: view.material })
        : `<p class="lab-dash-empty">กดสูตรในส่วนบนเพื่อดูเส้นควบคุมและตารางรายโม่</p>`);
      paintInto("#lab-drill", views.drillTable(item ? model.drillRows(item, view.today, view.days) : [], item));
    }

    function paintTrends() {
      view.trendWidth = trendWidth();
      paintInto("#lab-trends", views.trendGrid(view.trend, { since: model.windowSince(view.today, view.days), today: view.today, width: view.trendWidth }));
    }

    function paintAll() {
      view.trend = model.trendItems(view.materials, view.today, view.days);
      const names = view.trend.map((item) => item.material);
      if (!view.picked || !names.includes(view.material)) view.material = view.trend[0]?.material ?? null;
      paintInto("#lab-machine", views.machineBanner(model.machineItems(view.materials, view.today)));
      paintInto("#lab-today", views.todayStrip({ cards: model.latestCards(view.trend), attention: model.dashAttention(view.trend, view.materials, view.today), days: view.days }));
      paintTrends();
      paintInto("#lab-bias", views.biasTable(model.millBias(view.materials, view.today, view.days)));
      paintInto("#lab-uniform", views.uniformTable(model.strandUniformity(view.materials, view.today, view.days)));
      paintInto("#lab-notices", views.noticeBox(model.dataNotices(view.materials, view.today), Boolean(mooney.querySelector(".lab-notices[open]"))));
      paintSelection();
      paintControl();
    }

    mooney.addEventListener("click", (event) => {
      const range = event.target.closest("[data-days]");
      if (range) {
        view.days = Number(range.dataset.days);
        mooney.querySelectorAll("[data-days]").forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.days) === view.days)));
        return paintAll();
      }
      const measure = event.target.closest("[data-measure]");
      if (measure) {
        view.key = measure.dataset.measure === "mh" ? "mh" : "mv";
        return paintControl();
      }
      const pick = event.target.closest("[data-material]");
      if (pick) {
        view.material = pick.dataset.material;
        view.picked = true;
        paintSelection();
        paintControl();
      }
    });

    // กราฟกว้างตามกล่อง: วาดใหม่เมื่อความกว้างเปลี่ยน (หมุนจอ ย่อ/ขยายหน้าต่าง เปิด/ปิดเมนูข้าง)
    let frame = 0;
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
        if (view.mode !== "health") return;
        const plot = mooney.querySelector("#lab-control-plot");
        const plotChanged = plot && Math.abs(Math.floor(plot.clientWidth) - view.plotWidth) >= 2;
        if (!plotChanged && Math.abs(trendWidth() - view.trendWidth) < 2) return;
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => {
          paintTrends();
          paintSelection();
          paintControl();
        });
      })
      : null;
    observer?.observe(mooney);

    return {
      showStatus: bar.showStatus,
      setBusy: bar.setBusy,
      dispose() {
        observer?.disconnect();
        window.cancelAnimationFrame(frame);
      },
      update(feed) {
        bar.paintMeta(feed);
        const mode = feed.materials.length && model.hasHealth(feed.materials) ? "health" : "legacy";
        if (mode !== view.mode) {
          view.mode = mode;
          painted.clear();
          mooney.innerHTML = mode === "health" ? views.dashboardBody(view.days) : "";
        }
        if (mode === "legacy") {
          const html = views.dashboardMooney(model.overviewStats(feed.materials));
          if (painted.get("legacy") !== html) {
            painted.set("legacy", html);
            mooney.innerHTML = html;
          }
          return;
        }
        view.materials = feed.materials;
        view.today = model.todayInBangkok();
        paintAll();
      },
    };
  }
  /* ---------- หน้ารวม: รายการวัสดุ ---------- */

  // คืน { update(feed), showStatus, setBusy } — update วาดเฉพาะส่วนที่เปลี่ยน คงข้อความค้นหาและตัวเลือกเรียงของผู้ใช้ไว้
  function bindOverview() {
    const bar = bindLiveBar();
    const search = document.querySelector("#lab-search");
    const sort = document.querySelector("#lab-sort");
    const body = document.querySelector("#lab-materials");
    const empty = document.querySelector("#lab-empty");
    const count = document.querySelector("#lab-count");
    let materials = [];
    const paint = () => {
      const query = search.value.trim();
      const shown = model.sortMaterials(model.filterMaterials(materials, query), sort.value);
      body.innerHTML = views.materialRows(shown);
      empty.hidden = shown.length > 0;
      empty.textContent = materials.length === 0
        ? views.NO_RESULTS
        : `ไม่พบวัสดุที่ตรงกับ “${query}”`;
      // จำนวนวัสดุเห็นได้จากรายการอยู่แล้ว บอกเฉพาะตอนค้นหาว่าเหลือกี่จากกี่
      count.textContent = query ? `${shown.length} จาก ${materials.length}` : "";
    };
    // ช่องค้นหา = combobox: รายการวัสดุที่ตรงเด้งใต้ช่อง (listbox) เลือกแล้วเข้าหน้าวัสดุ ส่วนตารางยังกรองตามคำค้นเหมือนเดิม
    // รายการเป็น popup ตามกติกา AGENTS.md: อยู่กรอบเดียวกับช่อง (.lab-search) ปิดด้วยกฎกลาง closePopup ของ app.js เท่านั้น
    // (แตะ/ย้าย focus ออกนอกกรอบ, Escape, เลือกรายการ) ห้ามปิดจาก blur เพราะ iPhone ไม่ย้าย focus ไปที่ปุ่มที่ถูกแตะ
    // isOpen ตามสถานะจริงของรายการ โดยฟัง "popup-close" ที่ closePopup ส่งมาทุกครั้งที่ปิด
    const suggest = document.querySelector("#lab-search-list");
    let choices = [];
    let shown = "";
    let active = -1;
    let isOpen = false;

    const placeSuggest = () => {
      if (!search.isConnected) return stopTracking();
      window.MNP_SEARCHABLE_SELECT?.placeList?.(search, suggest);
    };
    const startTracking = () => {
      window.addEventListener("scroll", placeSuggest, true);
      window.addEventListener("resize", placeSuggest);
      window.visualViewport?.addEventListener("resize", placeSuggest);
    };
    function stopTracking() {
      window.removeEventListener("scroll", placeSuggest, true);
      window.removeEventListener("resize", placeSuggest);
      window.visualViewport?.removeEventListener("resize", placeSuggest);
    }

    function setActive(position, scroll = true) {
      active = position;
      suggest.querySelectorAll(".ss-option").forEach((node) => {
        const on = Number(node.dataset.pos) === position;
        node.classList.toggle("is-active", on);
        node.setAttribute("aria-selected", String(on));
      });
      const node = suggest.querySelector(`.ss-option[data-pos="${position}"]`);
      if (!node) return search.removeAttribute("aria-activedescendant");
      search.setAttribute("aria-activedescendant", node.id);
      if (scroll) node.scrollIntoView({ block: "nearest" });
    }

    // วาดรายการตามคำค้นตอนนี้ (เปิดถ้ายังปิดอยู่) ไม่มีวัสดุที่ตรง = ปิดรายการ เพราะตารางและตัวนับบอกอยู่แล้วว่าไม่พบ
    // พิมพ์แล้วไฮไลต์ตัวแรกที่ตรง (กด Enter เข้าได้ทันที) ยังไม่พิมพ์ = ไม่ไฮไลต์ · keepActive = รีเฟรชข้อมูลกลางทาง คงตัวที่ไฮไลต์ไว้และไม่วาดซ้ำถ้ารายการเดิม
    function showSuggestions({ keepActive = false } = {}) {
      const previous = isOpen && keepActive ? choices[active]?.material : undefined;
      choices = model.suggestMaterials(materials, search.value);
      if (!choices.length) {
        if (isOpen) closePopup(suggest);
        return;
      }
      const first = search.value.trim() ? 0 : -1;
      const signature = choices.map((item) => item.material).join("\n");
      if (isOpen && signature === shown) {
        if (!keepActive) setActive(first);
        return;
      }
      shown = signature;
      suggest.innerHTML = views.materialSuggestions(choices);
      if (!isOpen) {
        isOpen = true;
        suggest.hidden = false;
        search.setAttribute("aria-expanded", "true");
        startTracking();
      }
      placeSuggest();
      const kept = previous === undefined ? -1 : choices.findIndex((item) => item.material === previous);
      setActive(kept >= 0 ? kept : first);
    }

    function openMaterial(position) {
      const item = choices[position];
      if (!item) return;
      closePopup(suggest);
      location.hash = model.materialUrl(item.material);
    }

    suggest.addEventListener("popup-close", () => {
      isOpen = false;
      shown = "";
      active = -1;
      stopTracking();
    });
    // กดค้างบนรายการไม่ให้ช่องค้นหาเสีย focus (คีย์บอร์ดมือถือไม่หุบแล้วเด้งกลับตอนเลือก)
    suggest.addEventListener("mousedown", (event) => event.preventDefault());
    suggest.addEventListener("click", (event) => {
      const node = event.target.closest(".ss-option");
      if (node) openMaterial(Number(node.dataset.pos));
    });
    suggest.addEventListener("mousemove", (event) => {
      const node = event.target.closest(".ss-option");
      if (node && Number(node.dataset.pos) !== active) setActive(Number(node.dataset.pos), false);
    });
    search.addEventListener("click", () => showSuggestions());
    search.addEventListener("input", () => {
      paint();
      showSuggestions();
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        event.stopPropagation();
        closePopup(suggest);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!isOpen) return showSuggestions();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive(active < 0 ? (step > 0 ? 0 : choices.length - 1) : (active + step + choices.length) % choices.length);
      } else if (event.key === "Enter" && isOpen && active >= 0) {
        event.preventDefault();
        openMaterial(active);
      }
    });
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
        materials = feed.materials;
        bar.paintMeta(feed);
        paint();
        if (isOpen) showSuggestions({ keepActive: true });
      },
    };
  }

  /* ---------- หน้าวัสดุ: กราฟ MH/MV และตารางผลทดสอบ ---------- */

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  function bindMaterial(material) {
    const bar = bindLiveBar();
    const el = {
      none: document.querySelector("#lab-none"),
      body: document.querySelector("#lab-body"),
      materialSelect: document.querySelector("#lab-material-select"),
      idField: document.querySelector("#lab-id-field"),
      idSelect: document.querySelector("#lab-id-select"),
      orderSelect: document.querySelector("#lab-order-select"),
      plot: document.querySelector("#lab-plot"),
      tip: document.querySelector("#lab-tip"),
      key: document.querySelector("#lab-chart-key"),
      announce: document.querySelector("#lab-announce"),
      zoom: document.querySelector("#lab-zoom"),
      monthFrom: document.querySelector("#lab-month-from"),
      monthTo: document.querySelector("#lab-month-to"),
      tableNote: document.querySelector("#lab-table-note"),
      scroll: document.querySelector("#lab-table-scroll"),
      copy: document.querySelector("#lab-copy"),
    };

    // ข้อมูลของหน้า: series = ผลทั้งวัสดุตามลำดับในชีต, shown = สิ่งที่กราฟ/ตารางแสดงอยู่ (ทั้งวัสดุ หรือเฉพาะ ID ที่เลือก)
    const data = { series: null, ids: [], conditions: null, shown: { mode: "sequence", items: [] }, signature: "", plotWidth: 0, plot: null };
    // ตัวเลือกของผู้ใช้ที่ต้องคงไว้ตอนรีเฟรช: ID, ลำดับตาราง และจุดที่ปักหมุดไว้ (เก็บเป็น id ของแถว ไม่ใช่ตำแหน่ง เพราะตำแหน่งขยับเมื่อมีแถวใหม่)
    // zoom = ช่วงที่กราฟโหมดลำดับแสดง: { kind: "latest" | "all" } หรือ { kind: "months", from, to } ("YYYY-MM") คำนวณใหม่ทุกครั้งที่วาด (ตามข้อมูลใหม่/ความกว้างจอ)
    // หรือ { kind: "custom", start, end, follow } เมื่อซูม/เลื่อนมาเอง (ดู chart.rangeFor) เปิดหน้าใหม่เริ่มที่ "latest" เสมอ
    const view = { id: "", order: "newest", pinnedId: null, preview: null, zoom: { kind: "latest" } };
    let applied = "";

    const itemsOf = () => data.shown.items;

    // จุดที่กำลังดู: ชี้อยู่ (preview) ก่อน ถ้าไม่มีใช้ที่ปักหมุดไว้ ถ้าไม่มีทั้งคู่ = ไม่มีอะไรถูกเลือก (ไม่มีป้าย ไม่มีเส้นนำสายตา)
    function resolveFocus() {
      const items = itemsOf();
      if (view.preview !== null && view.preview < items.length) return { index: view.preview, kind: "preview" };
      const pinned = view.pinnedId === null ? -1 : items.findIndex((item) => item.id === view.pinnedId);
      return pinned >= 0 ? { index: pinned, kind: "pinned" } : null;
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

    // วางป้ายค่าข้างเส้นนำสายตา (ด้านขวาของเส้น ถ้าไม่พอที่ย้ายไปด้านซ้าย) ที่ส่วนบนของกราฟ
    function placeTip(index) {
      const svg = el.plot.querySelector("svg");
      if (!svg || !data.plot) return;
      const wrap = el.tip.offsetParent ?? el.plot.parentElement;
      const wrapRect = wrap.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      const x = svgRect.left - wrapRect.left + data.plot.xAt(index) * (svgRect.width / data.plotWidth);
      const width = el.tip.offsetWidth;
      el.tip.style.left = `${Math.max(4, wrapRect.width - x > width + 24 ? x + 12 : x - width - 12)}px`;
      el.tip.style.top = `${svgRect.top - wrapRect.top + 4}px`;
    }

    // วาดสถานะ "จุดที่ดูอยู่" ใหม่ทั้งหมด: ป้ายค่า เส้นนำสายตา วงรอบจุด และแถวในตาราง
    function applyFocus({ reveal = false, announce = false } = {}) {
      const items = itemsOf();
      const focus = resolveFocus();
      const item = focus ? items[focus.index] : null;
      const signature = item ? `${focus.index}|${item.id}` : "none";
      if (signature !== applied || reveal) {
        applied = signature;
        el.plot.querySelectorAll(".lab-pt.is-active").forEach((node) => node.classList.remove("is-active"));
        el.scroll.querySelectorAll("tr.is-active").forEach((row) => row.classList.remove("is-active"));
        const lines = el.plot.querySelectorAll(".lab-cross");
        // ครั้งที่เลือกอยู่นอกช่วงที่กราฟแสดง: ไม่มีป้ายและเส้นนำสายตาบนกราฟ แต่แถวในตารางยังสว่าง
        const inView = Boolean(item) && (!data.plot || data.plot.contains(focus.index));
        if (!inView) {
          lines.forEach((line) => line.setAttribute("visibility", "hidden"));
          el.tip.hidden = true;
        } else {
          const x = data.plot ? data.plot.xAt(focus.index) : 0;
          lines.forEach((line) => {
            line.setAttribute("x1", String(x));
            line.setAttribute("x2", String(x));
            line.setAttribute("visibility", "visible");
          });
          el.plot.querySelectorAll(`.lab-pt[data-i="${focus.index}"]`).forEach((node) => node.classList.add("is-active"));
          el.tip.innerHTML = views.tooltip({ item, mode: data.shown.mode });
          el.tip.hidden = false;
          placeTip(focus.index);
        }
        if (item) {
          const row = el.scroll.querySelector(`tr[data-seq="${item.seq}"]`);
          row?.classList.add("is-active");
          if (reveal && row) revealRow(row);
        }
      }
      if (announce) el.announce.textContent = item ? views.announcement({ item, mode: data.shown.mode }) : "";
    }

    // ช่องเดือน "… ถึง …" แสดงเดือนของครั้งแรกและครั้งสุดท้ายที่เห็นอยู่เสมอ (ซูมหรือเลื่อนแล้วค่าตามไปด้วย ไม่มีสถานะแยก) ตัวเลือก = ทุกเดือนที่มีผลทดสอบ
    // วาดตัวเลือกใหม่เฉพาะเมื่อรายการเดือนเปลี่ยน ไม่วาดทุกครั้งที่เลื่อน (ไม่ปิดตัวเลือกของระบบที่เปิดค้างอยู่)
    let monthKey = "";
    function paintMonths(range) {
      const items = itemsOf();
      const months = model.monthsOf(items);
      const first = model.monthOf(items[range.start]?.testDate);
      const last = model.monthOf(items[range.end - 1]?.testDate);
      const key = months.join();
      if (key !== monthKey) {
        monthKey = key;
        el.monthFrom.innerHTML = views.monthOptions(months, first);
        el.monthTo.innerHTML = views.monthOptions(months, last);
      }
      el.monthFrom.value = first ?? "";
      el.monthTo.value = last ?? "";
    }

    // แถบเครื่องมือช่วง/ซูม: โชว์เฉพาะโหมดลำดับ ปุ่มช่วงที่เลือกอยู่กดค้าง (aria-pressed) ปุ่มที่ไปต่อไม่ได้ปิดไว้
    function paintZoomBar() {
      const sequence = data.shown.mode === "sequence" && Boolean(data.plot?.total);
      el.zoom.hidden = !sequence;
      el.plot.classList.toggle("is-zoomed", sequence && data.plot.range.end - data.plot.range.start < data.plot.total);
      if (!sequence) return;
      const { range, total } = data.plot;
      const width = range.end - range.start;
      el.zoom.querySelectorAll("[data-range]").forEach((button) => {
        const key = button.dataset.range;
        button.setAttribute("aria-pressed", String(view.zoom.kind === key));
        if (key === "latest") button.textContent = `ล่าสุด ${chart.defaultCount(data.plotWidth)}`;
      });
      paintMonths(range);
      const limits = { back: range.start <= 0, forward: range.end >= total, out: width >= total, in: width <= Math.min(chart.MIN_VISIBLE, total) };
      el.zoom.querySelectorAll("[data-step]").forEach((button) => { button.disabled = limits[button.dataset.step]; });
    }

    function paintChart() {
      const width = Math.floor(el.plot.clientWidth);
      if (!width) return;
      data.plotWidth = width;
      const sequence = data.shown.mode === "sequence";
      const range = sequence ? chart.rangeFor(view.zoom, itemsOf(), width) : null;
      data.plot = chart.trendChart({ mode: data.shown.mode, items: itemsOf(), groups: sequence ? data.series.groups : [], width, label: material, range });
      el.plot.innerHTML = data.plot.html;
      el.key.innerHTML = views.chartKey(data.shown.mode, data.plot.bandSize);
      paintZoomBar();
      applied = "";
      applyFocus();
    }

    function paintTable({ resetScroll = false } = {}) {
      const top = el.scroll.scrollTop;
      const uniform = data.conditions.uniform;
      const focus = resolveFocus();
      const activeSeq = focus ? itemsOf()[focus.index].seq : null;
      el.scroll.innerHTML = data.shown.mode === "id"
        ? views.idTable({ rows: itemsOf(), order: view.order, uniform, activeSeq, id: view.id })
        : views.resultsTable({ series: data.series, order: view.order, uniform, activeSeq });
      el.scroll.scrollTop = resetScroll ? 0 : top;
    }

    function computeShown() {
      if (view.id && data.ids.some((entry) => entry.id === view.id)) data.shown = { mode: "id", items: model.idSeries(data.series.items, view.id) };
      else {
        view.id = "";
        data.shown = { mode: "sequence", items: data.series.items };
      }
      el.tableNote.textContent = views.tableNote({ count: itemsOf().length, groupCount: data.shown.mode === "sequence" ? data.series.groups.length : null, conditions: data.conditions });
    }

    function paintAll() {
      computeShown();
      el.idSelect.innerHTML = views.idOptions(data.ids, view.id);
      el.idSelect.value = view.id;
      el.orderSelect.value = view.order;
      paintTable();
      paintChart();
    }

    /* ----- การโต้ตอบ ----- */

    // ตำแหน่งแนวนอนในพิกัดของ SVG (ไม่ใช่พิกเซลหน้าจอ เพราะ SVG ย่อ/ขยายตามกล่อง)
    const svgX = (clientX) => {
      const svg = el.plot.querySelector("svg");
      if (!svg || !data.plot) return null;
      const rect = svg.getBoundingClientRect();
      return rect.width ? ((clientX - rect.left) * data.plotWidth) / rect.width : null;
    };
    const indexFromPointer = (event) => {
      const x = svgX(event.clientX);
      return x === null ? -1 : data.plot.indexAt(x);
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

    /* ----- ช่วงที่แสดง: ซูม เลื่อน ปุ่มช่วง ----- */

    const sequenceMode = () => data.shown.mode === "sequence" && Boolean(data.plot?.total);
    const rangeNow = () => (sequenceMode() ? data.plot.range : null);
    const announceRange = () => {
      const range = rangeNow();
      if (range) el.announce.textContent = views.rangeAnnouncement({ items: itemsOf(), range });
    };

    // ตั้งช่วงที่ซูม/เลื่อนมาเอง: ติดขอบขวา (ครั้งล่าสุด) อยู่ = ขยับตามเมื่อมีครั้งใหม่เข้ามา ไม่ติด = อยู่ที่เดิม
    function setRange(next) {
      if (!sequenceMode()) return;
      const total = data.plot.total;
      const range = chart.normalizeRange(next, total);
      if (chart.sameRange(range, data.plot.range)) return;
      view.zoom = { kind: "custom", start: range.start, end: range.end, follow: range.end >= total };
      paintChart();
    }

    // การลาก/บีบ/หมุนล้อยิงเหตุการณ์ถี่กว่าเฟรม: รวมเป็นหนึ่งการวาดต่อเฟรม
    let frameRange = null;
    let rangeFrame = 0;
    function scheduleRange(next) {
      frameRange = next;
      if (rangeFrame) return;
      rangeFrame = window.requestAnimationFrame(() => {
        rangeFrame = 0;
        const range = frameRange;
        frameRange = null;
        if (range) setRange(range);
      });
    }

    // จุดตรึงของปุ่ม/แป้นซูม (0 = ขอบซ้าย … 1 = ขอบขวาของช่วง): ครั้งที่ปักหมุดหรือชี้อยู่ ถ้าไม่มีและช่วงติดครั้งล่าสุดอยู่ = ขอบขวา
    // (ซูมแล้วยังเห็นครั้งล่าสุด) นอกนั้น = กลางกราฟ
    function focusAnchor() {
      const range = rangeNow();
      if (!range) return 0.5;
      const focus = resolveFocus();
      if (focus && data.plot.contains(focus.index)) return (focus.index - range.start + 0.5) / (range.end - range.start);
      return range.end >= data.plot.total ? 1 : 0.5;
    }

    function zoomBy(factor, anchor = focusAnchor()) {
      const range = rangeNow();
      if (range) setRange(chart.zoomRange(range, data.plot.total, factor, anchor));
    }
    function panBy(fraction) {
      const range = rangeNow();
      if (range) setRange(chart.panRange(range, data.plot.total, Math.max(1, Math.round((range.end - range.start) * Math.abs(fraction))) * Math.sign(fraction)));
    }
    // ให้ครั้งที่เลือกอยู่ในช่วงที่เห็น (ปักหมุดจากแป้นพิมพ์หรือคลิกแถวในตาราง)
    function revealIndex(index) {
      const range = rangeNow();
      if (range) setRange(chart.revealRange(range, data.plot.total, index));
    }

    const pin = (index, { toggle = false } = {}) => {
      const item = itemsOf()[index];
      if (!item) return;
      view.pinnedId = toggle && view.pinnedId === item.id ? null : item.id;
      view.preview = null;
      if (view.pinnedId !== null) revealIndex(index);
      applyFocus({ reveal: view.pinnedId !== null, announce: true });
    };

    // เลือกเดือน: ตั้งช่วงเป็นทุกครั้งที่ทดสอบของเดือนแรกถึงเดือนสุดท้ายที่เลือก (รวมทั้งสองเดือน) ถ้าเลือกเดือนเริ่มหลังเดือนจบ อีกช่องย้ายตามมาเป็นเดือนเดียวกัน
    el.zoom.addEventListener("change", (event) => {
      if (event.target !== el.monthFrom && event.target !== el.monthTo) return;
      let from = el.monthFrom.value;
      let to = el.monthTo.value;
      if (from > to) {
        if (event.target === el.monthFrom) to = from;
        else from = to;
      }
      view.zoom = { kind: "months", from, to };
      paintChart();
      announceRange();
    });

    el.zoom.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      if (button.dataset.range) {
        view.zoom = { kind: button.dataset.range };
        paintChart();
      } else if (button.dataset.step === "in") zoomBy(2);
      else if (button.dataset.step === "out") zoomBy(0.5);
      else if (button.dataset.step === "back") panBy(-0.5);
      else if (button.dataset.step === "forward") panBy(0.5);
      else return;
      announceRange();
    });

    // Ctrl + ล้อเมาส์ (และบีบสองนิ้วบนแทร็กแพด ซึ่งเบราว์เซอร์ส่งเป็นล้อพร้อม Ctrl) = ซูมรอบตำแหน่งเมาส์; ล้อธรรมดาให้หน้าเลื่อนตามปกติ
    // เลื่อนแนวนอน (แทร็กแพดปัดซ้ายขวา หรือ Shift + ล้อ) ขณะซูมอยู่ = เลื่อนช่วง
    el.plot.addEventListener("wheel", (event) => {
      const range = rangeNow();
      if (!range) return;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      if (event.ctrlKey) {
        event.preventDefault();
        const x = svgX(event.clientX);
        scheduleRange(chart.zoomRange(frameRange ?? range, data.plot.total, clamp(Math.exp(-event.deltaY * 0.003), 0.5, 2), x === null ? 0.5 : data.plot.fractionAt(x)));
      } else if (horizontal && range.end - range.start < data.plot.total) {
        event.preventDefault();
        scheduleRange(chart.panRange(frameRange ?? range, data.plot.total, horizontal / data.plot.slot));
      }
    }, { passive: false });

    // เมาส์: ชี้ = ดูค่า คลิก = ปักหมุด (คลิกซ้ำเพื่อปล่อย) ลากขณะซูมอยู่ = เลื่อนช่วง (ไม่ปักหมุด)
    // นิ้วและปากกา: แตะหรือลากนิ้วเดียวเพื่อดูค่า ปล่อยนิ้วแล้วปักหมุดจุดสุดท้าย; สองนิ้ว = บีบซูมและเลื่อนช่วง (ไม่ปักหมุด)
    const DRAG_PX = 5;
    let pressed = false;
    let drag = null;
    let gesture = null;
    const touches = new Map();
    const endGestures = () => {
      pressed = false;
      drag = null;
      gesture = null;
      el.plot.classList.remove("is-panning");
    };

    function startGesture() {
      const range = rangeNow();
      const [first, second] = [...touches.values()];
      const x = svgX((first.x + second.x) / 2);
      if (!range || x === null) return;
      pressed = false;
      drag = null;
      clearPreview();
      gesture = { range, distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)), anchor: range.start + data.plot.fractionAt(x) * (range.end - range.start) };
    }
    function updateGesture() {
      if (touches.size < 2) return;
      const [first, second] = [...touches.values()];
      const x = svgX((first.x + second.x) / 2);
      if (x === null) return;
      const total = data.plot.total;
      const size = gesture.range.end - gesture.range.start;
      const scale = Math.hypot(first.x - second.x, first.y - second.y) / gesture.distance;
      const width = clamp(Math.round(size / (scale || 1)), Math.min(chart.MIN_VISIBLE, total), total);
      const start = Math.round(gesture.anchor - data.plot.fractionAt(x) * width);
      scheduleRange(chart.normalizeRange({ start, end: start + width }, total));
    }

    el.plot.addEventListener("pointermove", (event) => {
      if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (gesture) return updateGesture();
      if (drag) {
        const x = svgX(event.clientX);
        if (x === null || (!drag.moved && Math.abs(event.clientX - drag.clientX) < DRAG_PX)) return;
        const moved = x - drag.x;
        if (!drag.moved) {
          drag.moved = true;
          el.plot.classList.add("is-panning");
          clearPreview();
          el.plot.setPointerCapture?.(event.pointerId);
        }
        return scheduleRange(chart.panRange(drag.range, data.plot.total, -moved / data.plot.slot));
      }
      if (event.pointerType === "mouse" || pressed) preview(indexFromPointer(event));
    });
    el.plot.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.pointerType === "touch") {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size === 2) return startGesture();
        if (touches.size > 2) return;
      }
      pressed = true;
      if (event.pointerType !== "mouse") preview(indexFromPointer(event));
      else if (data.plot && data.plot.range.end - data.plot.range.start < data.plot.total) {
        const x = svgX(event.clientX);
        if (x !== null) drag = { x, clientX: event.clientX, range: data.plot.range, moved: false };
      }
    });
    el.plot.addEventListener("pointerup", (event) => {
      touches.delete(event.pointerId);
      if (gesture) {
        if (touches.size < 2) gesture = null;
        pressed = false;
        return;
      }
      const wasPressed = pressed;
      const dragged = drag?.moved === true;
      pressed = false;
      drag = null;
      el.plot.classList.remove("is-panning");
      if (!wasPressed || dragged) return;
      const index = indexFromPointer(event);
      if (index < 0) return;
      pin(index, { toggle: true });
    });
    const leave = () => {
      endGestures();
      clearPreview();
    };
    el.plot.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "touch" || !drag?.moved) leave();
    });
    el.plot.addEventListener("pointercancel", (event) => {
      touches.delete(event.pointerId);
      leave();
    });
    el.plot.addEventListener("keydown", (event) => {
      const items = itemsOf();
      if (!items.length) return;
      const focus = resolveFocus();
      const last = items.length - 1;
      const targets = { ArrowLeft: focus ? focus.index - 1 : last, ArrowRight: focus ? focus.index + 1 : last, Home: 0, End: last };
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
      if (event.key === "Escape") {
        view.pinnedId = null;
        view.preview = null;
        applyFocus({ announce: true });
      } else if (plain && sequenceMode() && (event.key === "+" || event.key === "=")) {
        zoomBy(2);
        announceRange();
      } else if (plain && sequenceMode() && (event.key === "-" || event.key === "_")) {
        zoomBy(0.5);
        announceRange();
      } else if (plain && sequenceMode() && event.key === "0") {
        view.zoom = { kind: "latest" };
        paintChart();
        announceRange();
      } else if (plain && sequenceMode() && (event.key === "PageUp" || event.key === "PageDown")) {
        panBy(event.key === "PageUp" ? -0.5 : 0.5);
        announceRange();
      } else if (Object.hasOwn(targets, event.key)) {
        pin(clamp(targets[event.key], 0, last));
      } else return;
      event.preventDefault();
    });

    // ตาราง: ชี้แถว = ดูค่าของครั้งนั้นบนกราฟ คลิก/แตะแถว = ปักหมุด (คลิกซ้ำเพื่อปล่อย)
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
      if (index < 0) return;
      view.preview = null;
      view.pinnedId = view.pinnedId === itemsOf()[index].id ? null : itemsOf()[index].id;
      if (view.pinnedId !== null) revealIndex(index);
      applyFocus({ announce: true });
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
        ? views.idTsv({ rows: itemsOf(), order: view.order, uniform })
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
        window.cancelAnimationFrame(rangeFrame);
        window.clearTimeout(copyTimer);
      },
      update(feed) {
        bar.paintMeta(feed);
        // The selector comes from the compact overview, even on a material-only response.
        el.materialSelect.innerHTML = views.materialOptions(feed.materials, material);
        const signature = model.feedSignature(feed.rows);
        // ชีตไม่เปลี่ยนจากรอบก่อน: ไม่วาดใหม่ (ไม่กระพริบ ไม่เสียจุดที่ผู้ใช้ปักหมุดหรือตำแหน่งเลื่อนในตาราง)
        if (signature === data.signature) return;
        data.signature = signature;
        const rows = feed.rows.filter((row) => row.material === material);
        el.none.hidden = rows.length > 0;
        el.body.hidden = rows.length === 0;
        el.idField.hidden = rows.length === 0;
        if (!rows.length) {
          data.series = null;
          return;
        }
        data.series = model.buildSeries(feed.rows, material);
        data.ids = model.idsFor(data.series.items);
        data.conditions = model.testConditions(data.series.items);
        paintAll();
      },
    };
  }

  /* ---------- เปิดหน้า ---------- */

  async function openPage({ title, html, bind, material }) {
    stopAutoRefresh();
    bindCacheOwner();
    const version = ++pageVersion;
    let feed = cache.get(material || "");
    const cached = Boolean(feed);
    if (!feed) {
      loadingShell(PATH, title);
      try {
        feed = await loadFeed(material);
      } catch (error) {
        if (version !== pageVersion) return;
        if (isDenied(error)) return revoke();
        throw error;
      }
    }
    if (version !== pageVersion) return;
    app.innerHTML = shell(html, PATH, title);
    bindShell();
    const view = bind();
    view.update(feed);
    view.showStatus(feedStatus(feed));
    startAutoRefresh(view, material);
    if (zoomOnPaint) {
      zoomOnPaint = false;
      zoomIntoContent();
    }
    // Cached navigation paints immediately but always rechecks server permissions/data.
    if (cached) void refreshNow();
  }

  // หน้าเลือกโมดูล (#/lab): การ์ดสีของ 4 โมดูล ไม่มีข้อมูลผลทดสอบ จึงไม่เรียกฐานข้อมูล
  // กดการ์ด = หน้าโมดูลซูมเข้าเมื่อวาดเสร็จ (zoomIntoContent ของ app.js ตัวเดียวกับหน้าคำร้อง)
  let zoomTo = null;
  let zoomOnPaint = false;
  function openChooser() {
    pageVersion += 1;
    app.innerHTML = shell(sections.chooserPage((key) => Object.hasOwn(PAGES, key)), PATH, TITLE);
    bindShell();
    document.querySelectorAll(".lab-module-card[href]").forEach((card) => card.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      zoomTo = card.hash;
    }));
  }

  // โมดูลที่ยังไม่มีแหล่งข้อมูล (เปิดจาก URL ตรง ๆ เท่านั้น การ์ดไม่เป็นลิงก์): หน้าคงที่ ไม่มีคำขอไปฐานข้อมูล และไม่มีรีเฟรชอัตโนมัติ
  function openNotReady(section) {
    pageVersion += 1;
    app.innerHTML = shell(sections.notReadyPage(section), PATH, TITLE);
    bindShell();
  }

  // หน้าของโมดูลที่มีข้อมูลแล้ว — ที่เดียวที่ตัดสินว่าโมดูลใดเปิดใช้งาน โมดูลใน lab-sections.js ที่ไม่มีที่นี่แสดงว่ายังไม่เปิดใช้งาน
  const SECONDS = REFRESH_MS / 1000;
  const PAGES = {
    dashboard: () => openPage({ title: TITLE, html: views.dashboardPage(SECONDS), material: null, bind: bindDashboard }),
    mooney: (params) => {
      const material = model.readMaterial(params.get("material"));
      return material
        ? openPage({ title: TITLE, html: views.materialPage(material, SECONDS), material, bind: () => bindMaterial(material) })
        : openPage({ title: TITLE, html: views.overviewPage(SECONDS), material: null, bind: bindOverview });
    },
  };

  async function renderLab(params) {
    stopAutoRefresh();
    zoomOnPaint = zoomTo !== null && zoomTo === location.hash;
    zoomTo = null;
    // เมนูถูกซ่อนเมื่อไม่มีสิทธิ์ แต่พิมพ์ URL เองได้ — RPC เป็นด่านตรวจสิทธิ์จริง
    if (state.employee?.labAccess !== true) return deniedPage();
    const section = sections.readSection(params);
    if (!section) return deniedPage(); // ?module= ที่ไม่มีจริง = URL ที่ไม่มีอยู่
    if (section === sections.HOME) return openChooser();
    return Object.hasOwn(PAGES, section) ? await PAGES[section](params) : openNotReady(section);
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.MNP_LAB = {
    code: "MNP_LAB",
    enabled: true,
    standalone: true,
    label: TITLE,
    errorMessages: {
      LAB_SYNC_NOT_READY: "ข้อมูล LAB ยังซิงก์ไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ",
      LAB_FEED_UNREADABLE: "อ่านข้อมูล LAB ไม่สำเร็จ กรุณาลองอีกครั้งหรือติดต่อผู้ดูแลระบบ",
    },
    navAllowed: (employee) => employee?.labAccess === true,
    nav: [{ path: PATH, label: TITLE, icon: NAV_ICON }],
    pages: { [PATH]: renderLab },
  };
})();
