// หน้า "จัดการข้อมูลทดสอบ" ของฝ่ายโรงงาน (โหมดทดสอบ) — view "test-data" ในเมนูโรงงาน › ข้อมูลทดสอบ
//
// รวมงานเตรียมข้อมูลทดสอบไว้ที่เดียว (เดิมอยู่ท้ายทะเบียนสินค้า): ดูว่ามีข้อมูลทดสอบอะไรเท่าไร · เติมชุดข้อมูลตัวอย่าง ·
// ล้างข้อมูลทดสอบแบบสองขั้น (กด "ตรวจรายการที่จะลบ" เห็นจำนวนแยกประเภทก่อน แล้วจึงยืนยัน) แนวคิดจาก ERPNext ดู
// modules/factory-test-data-model.js ฐานข้อมูลตรวจสิทธิ์ admin และโหมดทดสอบเองทุก RPC
// (20261014030000_factory_sandbox_test_data_summary.sql) การซ่อน/ปิดปุ่มในหน้านี้เป็นเพียงความสะดวก
//
// แผงตรวจรายการที่จะลบอยู่ในหน้า ไม่ใช่ popup ลอยหรือ modal จึงไม่มีโค้ดปิดตอนแตะนอกกรอบ (แตะบน iPhone ได้ตามปกติ)
// ไฟล์นี้โหลดหลัง modules/factory-attachments.js และก่อน modules/module-factory.js (ดู index.html)
// ฟังก์ชันข้างในเรียก helper ของ app.js (sb, escapeHtml, showToast, friendlyError, renderRoute) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerFactoryTestDataView() {
  const model = window.MNP_FACTORY_TEST_DATA_MODEL;
  const menu = window.MNP_FACTORY_ITEM_MASTER;
  const count = (value) => escapeHtml(model.formatCount(value));

  async function loadSummary() {
    const { data, error } = await sb.rpc("app_sandbox_factory_test_data");
    if (error) throw error;
    return data ?? {};
  }

  // ---------- ตอนนี้มีข้อมูลทดสอบอะไร ----------
  function statusHtml(summary) {
    const total = model.total(summary.counts);
    const cells = model.rows(summary.counts).map((row) => `<div class="ftd-count${row.count ? "" : " is-zero"}">
        <dt>${escapeHtml(row.label)}</dt><dd><strong>${count(row.count)}</strong> <span>${escapeHtml(row.unit)}</span></dd>
      </div>`).join("");
    return `<section class="card ftd-status" aria-labelledby="ftd-status-title">
        <div class="ftd-head">
          <h2 id="ftd-status-title">${total ? `มีข้อมูลทดสอบ ${count(total)} แถว` : "ยังไม่มีข้อมูลทดสอบ"}</h2>
          <p class="muted small">${total
            ? "นับเฉพาะข้อมูลของโหมดทดสอบ ข้อมูลจริงไม่รวมอยู่ในตัวเลขนี้"
            : "เริ่มจากเติมชุดข้อมูลตัวอย่างด้านล่าง แล้วลองเดิน workflow ได้ทันทีโดยไม่กระทบข้อมูลจริง"}</p>
        </div>
        <dl class="ftd-counts">${cells}</dl>
      </section>`;
  }

  // ---------- ชุดข้อมูลตัวอย่าง ----------
  function setActionHtml(set, state) {
    if (state === "ready") return `<button class="btn small" type="button" data-seed="${escapeHtml(set.key)}">${escapeHtml(set.action)}</button>`;
    if (state === "loaded") return `<a class="btn secondary small" href="${escapeHtml(menu.url(set.link))}">${escapeHtml(set.linkLabel)} →</a>`;
    return `<span class="ftd-blocked">ทะเบียนสินค้าต้องว่างก่อน ล้างข้อมูลทดสอบแล้วจึงเติมชุดนี้ได้</span>`;
  }

  function setsHtml(summary) {
    const items = model.SETS.map((set) => {
      const state = model.setState(set, summary.sets);
      return `<li class="ftd-set">
          <div class="ftd-set-copy">
            <div class="ftd-set-title"><h3>${escapeHtml(set.name)}</h3><span class="badge ftd-state-${state}">${escapeHtml(model.SET_STATE_LABELS[state])}</span></div>
            <p>${escapeHtml(set.description)}</p>
            <ul class="ftd-includes" aria-label="สิ่งที่อยู่ในชุด">${set.includes.map((part) => `<li>${escapeHtml(part)}</li>`).join("")}</ul>
          </div>
          <div class="ftd-set-action">${setActionHtml(set, state)}</div>
        </li>`;
    }).join("");
    return `<section class="card" aria-labelledby="ftd-sets-title">
        <div class="ftd-head">
          <h2 id="ftd-sets-title">ชุดข้อมูลตัวอย่าง</h2>
          <p class="muted small">ข้อมูลสมมติสำหรับทดลอง ไม่ใช่ข้อมูลจริง แต่ละชุดเติมได้ครั้งเดียวจนกว่าจะล้างข้อมูลทดสอบ</p>
        </div>
        <ul class="ftd-sets">${items}</ul>
      </section>`;
  }

  // ---------- ล้างข้อมูลทดสอบ (สองขั้น) ----------
  function purgeHtml(summary) {
    const total = model.total(summary.counts);
    return `<section class="card ftd-purge" aria-labelledby="ftd-purge-title">
        <div class="ftd-head">
          <h2 id="ftd-purge-title">ล้างข้อมูลทดสอบ</h2>
          <p class="muted small">ลบข้อมูลทดสอบทั้งหมดของฝ่ายโรงงานและเริ่มนับเลขเอกสารทดสอบใหม่ ข้อมูลจริงไม่ถูกแตะ ระบบบันทึกจำนวนที่ลบไว้ในประวัติการใช้งาน</p>
        </div>
        ${total
          ? `<button class="btn danger" type="button" id="ftd-review">ตรวจรายการที่จะลบ</button>`
          : `<p class="ftd-blocked">ไม่มีข้อมูลทดสอบให้ล้าง</p>`}
        <div class="ftd-review" id="ftd-review-panel" hidden></div>
      </section>`;
  }

  // แผงยืนยัน: ใช้ตัวเลขที่เพิ่งโหลดใหม่ตอนกดตรวจ ไม่ใช่ตัวเลขตอนเปิดหน้า (หน้าต่างอื่นอาจเติม/ล้างไปแล้ว)
  function reviewHtml(summary) {
    const plan = model.purgePlan(summary.counts);
    if (!plan.length) {
      return `<h3 tabindex="-1">ไม่มีข้อมูลทดสอบให้ล้างแล้ว</h3>
        <p class="muted small">ข้อมูลอาจถูกล้างจากหน้าต่างอื่น</p>
        <div class="ftd-review-actions"><button class="btn secondary" type="button" id="ftd-cancel">ปิด</button></div>`;
    }
    const total = model.total(summary.counts);
    const files = plan.find((row) => row.key === "attachments")?.count ?? 0;
    return `<h3 tabindex="-1">รายการที่จะลบ ${count(total)} แถว</h3>
      <table class="ftd-plan">
        <thead><tr><th scope="col">ประเภทข้อมูล</th><th scope="col" class="right">จำนวน</th></tr></thead>
        <tbody>${plan.map((row) => `<tr><th scope="row">${escapeHtml(row.label)}</th><td class="right"><strong>${count(row.count)}</strong> ${escapeHtml(row.unit)}</td></tr>`).join("")}</tbody>
      </table>
      <ul class="ftd-review-notes">
        ${files ? `<li>ลบไฟล์แนบ ${count(files)} ไฟล์ออกจาก Storage ก่อน ถ้าลบไม่หมดระบบจะไม่ล้างข้อมูลต่อ</li>` : ""}
        <li>เลขที่ใบสั่งผลิต ใบสั่งงาน ใบสั่งวัตถุดิบ และใบงานของโหมดทดสอบเริ่มนับใหม่</li>
        <li>ย้อนกลับไม่ได้ แต่เติมชุดข้อมูลตัวอย่างใหม่ได้ทันที</li>
      </ul>
      <div class="ftd-review-actions">
        <button class="btn danger ftd-confirm" type="button" id="ftd-confirm">ยืนยันล้าง ${count(total)} แถว</button>
        <button class="btn secondary" type="button" id="ftd-cancel">ยกเลิก</button>
      </div>`;
  }

  function pageHtml(summary) {
    return `<div class="ftd-page">${statusHtml(summary)}${setsHtml(summary)}${purgeHtml(summary)}</div>`;
  }

  function bindSeeds(root) {
    root.querySelectorAll("[data-seed]").forEach((button) => button.addEventListener("click", async (event) => {
      // ชุดมาจากรายการที่รู้จักเท่านั้น ค่าใน DOM ใช้หาเท่านั้น ไม่ใช้เป็นชื่อ RPC
      const set = model.SETS.find((candidate) => candidate.key === event.currentTarget.dataset.seed);
      if (!set) return;
      const target = event.currentTarget;
      target.disabled = true;
      try {
        const { data, error } = await sb.rpc(set.rpc);
        if (error) throw error;
        showToast(model.seedMessage(set.key, data));
        await renderRoute();
      } catch (error) {
        target.disabled = false;
        showToast(friendlyError(error), "error");
      }
    }));
  }

  function bindPurge(root) {
    const review = root.querySelector("#ftd-review");
    const panel = root.querySelector("#ftd-review-panel");
    if (!review || !panel) return;

    const close = () => {
      panel.hidden = true;
      panel.innerHTML = "";
      review.hidden = false;
      review.disabled = false;
      review.focus?.();
    };

    review.addEventListener("click", async () => {
      review.disabled = true;
      let summary;
      try {
        summary = await loadSummary();
      } catch (error) {
        review.disabled = false;
        showToast(friendlyError(error), "error");
        return;
      }
      panel.innerHTML = reviewHtml(summary);
      panel.hidden = false;
      review.hidden = true;
      panel.querySelector("h3")?.focus?.();
      panel.querySelector("#ftd-cancel")?.addEventListener("click", close);
      const confirmButton = panel.querySelector("#ftd-confirm");
      confirmButton?.addEventListener("click", async () => {
        const cancel = panel.querySelector("#ftd-cancel");
        confirmButton.disabled = true;
        if (cancel) cancel.disabled = true;
        try {
          // ไฟล์แนบอยู่ใน Storage ซึ่ง SQL ลบไม่ได้ ลบไฟล์ก่อน ถ้าลบไม่หมดจะไม่ล้างข้อมูลต่อ (ฐานข้อมูลก็ปฏิเสธเองถ้ายังมีไฟล์ค้าง)
          await window.MNP_FACTORY_ATTACHMENTS?.removeAll();
          const { data, error } = await sb.rpc("app_sandbox_purge_factory");
          if (error) throw error;
          showToast(model.purgeMessage(data));
          await renderRoute();
        } catch (error) {
          confirmButton.disabled = false;
          if (cancel) cancel.disabled = false;
          showToast(friendlyError(error), "error");
        }
      });
    });
  }

  const VIEWS = (window.MNP_FACTORY_VIEWS ??= {});
  VIEWS["test-data"] = async ({ frame }) => {
    frame.loading();
    let summary;
    try {
      summary = await loadSummary();
    } catch (error) {
      // PGRST202 = ฐานข้อมูลยังไม่ได้ขึ้น migration ของหน้านี้ (deploy หน้าเว็บก่อน db push)
      const message = error?.code === "PGRST202"
        ? "ฐานข้อมูลยังไม่ได้อัปเดตสำหรับหน้านี้ กรุณา push migration ล่าสุดก่อน"
        : friendlyError(error);
      frame.paint({ body: `<section class="card"><div class="empty">${escapeHtml(message)}</div></section>` });
      return;
    }
    const root = frame.paint({ body: pageHtml(summary) });
    bindSeeds(root);
    bindPurge(root);
  };

  window.MNP_FACTORY_TEST_DATA_UI = { statusHtml, setsHtml, purgeHtml, reviewHtml };
})();
