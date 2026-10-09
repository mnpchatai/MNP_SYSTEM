// ตัวแทนของฟังก์ชันใน app.js ที่ modules/factory-attachments.js เรียกใช้ (script ธรรมดาใน browser ไม่มี app.js ในเทสต์)
// ใส่ลงใน context ของ vm พร้อมโหลด "modules/factory-attachments.js" ต่อจาก module-factory-master.js ในทุกเทสต์ที่วาดหน้าโรงงาน
export const ATTACHMENT_STUBS = {
  extraFilesFieldHtml: (id, label = "แนบไฟล์เพิ่มเติม (ถ้ามี)") =>
    `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" name="extra_files" type="file" multiple></div>`,
  readExtraFiles: (input) => (input ? Array.from(input.files ?? []) : []),
  attachmentGalleryHtml: (files) => (files.length ? `<div id="attachment-gallery">${files.map((file) => file.file_name).join(",")}</div>` : '<p class="muted small">ยังไม่มีไฟล์แนบ</p>'),
  hydrateAttachmentGallery: async () => {},
  openAttachmentLightbox: () => {},
  uploadAttachmentBatch: async (files, uploadOne) => {
    const failed = [];
    for (const file of files) {
      try { await uploadOne(file); } catch (error) { failed.push({ name: file.name, error }); }
    }
    return { total: files.length, failed };
  },
  attachmentBatchFailureText: ({ total, failed }) => `แนบไฟล์ไม่สำเร็จ ${failed.length} จาก ${total} ไฟล์ (${failed.map((item) => item.name).join(", ")})`,
};
