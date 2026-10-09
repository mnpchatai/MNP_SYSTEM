// ไฟล์แนบของเอกสารฝ่ายโรงงาน (โหมดทดสอบ): ใช้ร่วมกันทุกฟอร์มของโมดูลโรงงาน
//
//   fieldHtml(id)                   ช่อง "แนบไฟล์เพิ่มเติม" วางในฟอร์มใดก็ได้ (ชื่อช่อง extra_files)
//   read(input)                     ตรวจไฟล์ที่เลือก (ชนิด/ขนาด/จำนวน) ก่อนยิง RPC ของการกระทำ — ไฟล์ผิดต้องไม่ทำให้การกระทำสำเร็จไปครึ่งเดียว
//   upload(type, id, files)         อัปโหลดหลังการกระทำสำเร็จ คืนข้อความเตือนถ้ามีไฟล์พลาด ("" = ครบหรือไม่มีไฟล์) การกระทำไม่ถูกย้อน
//   panelHtml(type, id)             ส่วน "ไฟล์แนบ" ของเอกสาร (รายการไฟล์ + ฟอร์มแนบเพิ่ม) วาดเมื่อ frame.paint เรียก mountAll()
//   removeAll()                     ลบไฟล์ทั้งหมดผ่าน Storage API ก่อนล้างข้อมูลทดสอบ (SQL ลบไฟล์จริงไม่ได้ ดู 20261009030000)
//
// ไฟล์เก็บใน bucket factory-attachments (private) ลงทะเบียนผ่าน app_factory_add_attachment ซึ่งตรวจโหมดทดสอบ เอกสารปลายทาง
// และไฟล์จริงใน Storage เอง ฟังก์ชันของ app.js (sb, escapeHtml, formatDate, showToast, friendlyError, setFormBusy,
// optionalAttachments, uploadAttachmentBatch, attachmentBatchFailureText, attachmentGalleryHtml, hydrateAttachmentGallery,
// openAttachmentLightbox, extraFilesFieldHtml, readExtraFiles) เรียกได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
// โหลดหลัง modules/module-factory-master.js (ใช้ window.MNP_FACTORY_ERRORS) และก่อน view อื่นของโรงงาน
(function registerFactoryAttachments() {
  const BUCKET = "factory-attachments";
  const TYPES = ["item", "bom", "production_order", "material_order", "job"];
  const REMOVE_CHUNK = 100;

  Object.assign(window.MNP_FACTORY_ERRORS ??= {}, {
    INVALID_ATTACHMENT: "ไฟล์แนบไม่ถูกต้อง",
    ATTACHMENT_NOT_UPLOADED: "ไม่พบไฟล์ที่อัปโหลด กรุณาแนบใหม่",
    ATTACHMENT_ENTITY_NOT_FOUND: "ไม่พบเอกสารที่จะแนบไฟล์ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    FACTORY_FILES_REMAIN: "ลบไฟล์แนบไม่หมด กรุณาลองล้างข้อมูลทดสอบอีกครั้ง",
  });

  const fieldHtml = (id, label) => extraFilesFieldHtml(id, label);
  const read = (input) => readExtraFiles(input);

  async function uploadOne(type, id, file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const storagePath = `${type}/${id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await sb.storage.from(BUCKET).upload(storagePath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await sb.rpc("app_factory_add_attachment", {
      p_entity_type: type, p_entity_id: id, p_storage_path: storagePath, p_file_name: file.name.slice(0, 255),
    });
    if (error) {
      await sb.storage.from(BUCKET).remove([storagePath]);
      throw error;
    }
  }

  async function upload(type, id, files) {
    if (!TYPES.includes(type)) throw new Error("INVALID_ATTACHMENT");
    if (!files?.length) return "";
    const uploaded = await uploadAttachmentBatch(files, (file) => uploadOne(type, id, file));
    return uploaded.failed.length
      ? `${attachmentBatchFailureText(uploaded)} · บันทึกการดำเนินการแล้ว กรุณาแนบไฟล์ที่ไม่สำเร็จใหม่ที่ส่วน "ไฟล์แนบ"`
      : "";
  }

  // ตำแหน่งของส่วนไฟล์แนบ: view วาดโครงนี้ไว้ในหน้า แล้ว frame.paint เรียก mountAll() เติมรายการไฟล์ให้
  function panelHtml(type, id) {
    return `<section class="card fm-attachments" data-fm-attachments="${escapeHtml(type)}" data-entity-id="${escapeHtml(id)}">
      <h2>ไฟล์แนบ</h2><p class="muted small">กำลังโหลดไฟล์แนบ…</p></section>`;
  }

  async function renderPanel(section) {
    const type = section.dataset.fmAttachments;
    const id = section.dataset.entityId;
    const { data, error } = await sb.rpc("app_factory_list_attachments", { p_entity_type: type, p_entity_id: id });
    if (error) throw error;
    const files = data ?? [];
    section.innerHTML = `<h2>ไฟล์แนบ</h2>
      <p class="muted small">แนบจากฟอร์มของเอกสารนี้หรือแนบเพิ่มที่นี่ได้ตลอด ไฟล์ไม่ถูกลบจนกว่าจะล้างข้อมูลทดสอบ</p>
      ${attachmentGalleryHtml(files)}
      ${files.length ? `<ul class="muted small fm-attachment-by">${files.map((file) => `<li>${escapeHtml(file.file_name)} · ${escapeHtml(file.uploader_name || "—")} · ${escapeHtml(formatDate(file.created_at, true))}</li>`).join("")}</ul>` : ""}
      <form class="fm-attachment-form">${fieldHtml(`fm-attach-${id}`, "แนบไฟล์เพิ่ม")}
        <div class="form-actions"><button class="btn secondary small" type="submit">อัปโหลด</button></div></form>`;
    section.querySelector("#attachment-gallery")?.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-attachment-open]");
      if (trigger) openAttachmentLightbox(trigger.dataset.attachmentOpen);
    });
    section.querySelector(".fm-attachment-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      let selected;
      try {
        selected = read(form.elements.extra_files);
        if (!selected.length) throw new Error("กรุณาเลือกไฟล์");
      } catch (error) {
        return showToast(friendlyError(error), "error");
      }
      setFormBusy(form, true);
      try {
        const warning = await upload(type, id, selected);
        showToast(warning || `อัปโหลดไฟล์แล้ว${selected.length > 1 ? ` ${selected.length} ไฟล์` : ""}`, warning ? "error" : "success");
      } catch (error) {
        showToast(friendlyError(error), "error");
      }
      await renderPanel(section).catch((error) => showToast(friendlyError(error), "error"));
    });
    hydrateAttachmentGallery(files, BUCKET).catch((error) => showToast(friendlyError(error), "error"));
  }

  async function mountAll() {
    for (const section of document.querySelectorAll("[data-fm-attachments]")) {
      try {
        await renderPanel(section);
      } catch (error) {
        section.innerHTML = `<h2>ไฟล์แนบ</h2><p class="muted small">โหลดไฟล์แนบไม่สำเร็จ: ${escapeHtml(friendlyError(error))}</p>`;
      }
    }
  }

  // ล้างข้อมูลทดสอบ: ลบไฟล์จริงก่อน (ลบไม่หมด = ไม่ล้างต่อ เพื่อไม่ให้เหลือไฟล์ที่ไม่มีแถวชี้)
  async function removeAll() {
    const { data, error } = await sb.rpc("app_factory_attachment_paths");
    // ฐานข้อมูลยังไม่ได้ขึ้น migration ไฟล์แนบ (PGRST202 = ไม่พบฟังก์ชัน) = ยังไม่มีไฟล์ให้ลบ ล้างข้อมูลทดสอบต่อได้ตามเดิม
    if (error?.code === "PGRST202") return 0;
    if (error) throw error;
    const paths = data ?? [];
    for (let index = 0; index < paths.length; index += REMOVE_CHUNK) {
      const { error: removeError } = await sb.storage.from(BUCKET).remove(paths.slice(index, index + REMOVE_CHUNK));
      if (removeError) throw removeError;
    }
    return paths.length;
  }

  window.MNP_FACTORY_ATTACHMENTS = { BUCKET, TYPES, fieldHtml, read, upload, panelHtml, mountAll, removeAll };
})();
