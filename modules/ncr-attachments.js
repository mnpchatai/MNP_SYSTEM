// NCR files use a separate private bucket in Admin Sandbox.
// Shared with the normal NCR forms; the server validates report scope and mode.
(function registerNcrAttachments() {
  const TEST_BUCKET = "ncr-test-attachments";
  const REMOVE_CHUNK = 100;
  const bucket = (isTest = Boolean(state.employee?.isSandbox)) => isTest ? TEST_BUCKET : "ncr-attachments";
  const fieldHtml = (id, label) => `<div class="field"><label for="${escapeHtml(id)}">${escapeHtml(label)}</label><input class="input" id="${escapeHtml(id)}" name="evidence" type="file" multiple accept="image/*,.heic,.heif,.pdf,.txt,.docx,.xlsx"><small>${ATTACHMENT_HINT}</small></div>`;

  async function uploadOne(ncrId, file, section) {
    const target = bucket();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const storagePath = `${ncrId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await sb.storage.from(target).upload(storagePath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await sb.rpc("app_ncr_add_attachment", {
      p_ncr_id: ncrId, p_section: section, p_storage_path: storagePath, p_file_name: file.name.slice(0, 255),
    });
    if (error) {
      await sb.storage.from(target).remove([storagePath]);
      throw error;
    }
  }

  async function purge() {
    const { data: paths, error: beginError } = await sb.rpc("app_sandbox_begin_ncr_file_cleanup");
    if (beginError) throw beginError;
    let result;
    let failure;
    try {
      const files = paths ?? [];
      for (let index = 0; index < files.length; index += REMOVE_CHUNK) {
        const { error } = await sb.storage.from(TEST_BUCKET).remove(files.slice(index, index + REMOVE_CHUNK));
        if (error) throw error;
      }
      const { data, error } = await sb.rpc("app_sandbox_purge_ncr");
      if (error) throw error;
      result = data;
    } catch (error) {
      failure = error;
    } finally {
      // Reset temporary cleanup access even if a Storage request fails or throws.
      try {
        const { error } = await sb.rpc("app_sandbox_finish_ncr_file_cleanup");
        if (error && !failure) failure = error;
      } catch (error) {
        if (!failure) failure = error;
      }
    }
    if (failure) throw failure;
    return result;
  }

  window.MNP_NCR_ATTACHMENTS = { bucket, fieldHtml, uploadOne, purge };
})();
