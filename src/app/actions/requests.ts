"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { resolveApprovalTarget } from "@/lib/data";
import { notifyEmployeeByEmail } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const allowedPriorities = new Set(["low", "normal", "high", "urgent"]);
const allowedAttachmentTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

async function employeeHasPermission(roleId: string, permissionCode: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("role_permissions")
    .select("permission:permissions!inner(code)")
    .eq("role_id", roleId)
    .eq("permissions.code", permissionCode)
    .maybeSingle();
  return Boolean(data);
}

export async function createRequestAction(formData: FormData) {
  const employee = await getCurrentEmployee();
  const requestTypeId = String(formData.get("request_type_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priority = String(formData.get("priority") ?? "normal");
  const attachmentValue = formData.get("attachment");
  const attachment = attachmentValue instanceof File && attachmentValue.size > 0 ? attachmentValue : null;

  if (title.length < 3 || title.length > 200) fail("/requests/new", "กรุณาระบุหัวข้อ 3–200 ตัวอักษร");
  if (description.length < 3 || description.length > 5000) fail("/requests/new", "กรุณาระบุรายละเอียด 3–5,000 ตัวอักษร");
  if (!allowedPriorities.has(priority)) fail("/requests/new", "ระดับความสำคัญไม่ถูกต้อง");
  if (attachment?.size && attachment.size > 10 * 1024 * 1024) fail("/requests/new", "ไฟล์ต้องมีขนาดไม่เกิน 10 MB");
  if (attachment && !allowedAttachmentTypes.has(attachment.type)) fail("/requests/new", "ชนิดไฟล์ไม่รองรับ");

  const details: Record<string, string> = {};
  for (const key of [
    "asset_code", "location", "preferred_date", "impact", "vehicle_no", "odometer",
    "estimated_cost", "required_date", "vendor", "business_reason", "system_name",
    "access_level", "leave_type", "start_date", "end_date", "course_name", "provider",
    "attachment_note", "cc_other_note",
  ]) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) details[key] = value.slice(0, 500);
  }

  const admin = createAdminClient();
  const { data: type } = await admin
    .from("request_types")
    .select("*")
    .eq("id", requestTypeId)
    .eq("is_active", true)
    .single();
  if (!type) fail("/requests/new", "ไม่พบประเภทคำร้องที่เลือก");

  // ส่วนที่ 3 ของฟอร์ม PP01-FM08 "สำเนาถึงแผนก" — checkbox หลายค่าชื่อเดียวกัน
  const ccDepartmentIds = [...new Set(formData.getAll("cc_department_ids").map((value) => String(value)))];
  if (ccDepartmentIds.length) {
    const { data: validDepartments } = await admin
      .from("departments")
      .select("id")
      .eq("is_active", true)
      .in("id", ccDepartmentIds);
    if ((validDepartments?.length ?? 0) !== ccDepartmentIds.length) {
      fail("/requests/new", "แผนกที่เลือกสำเนาถึงไม่ถูกต้อง");
    }
  }

  const { data: request, error } = await admin
    .from("requests")
    .insert({
      request_type_id: requestTypeId,
      requester_id: employee.id,
      department_id: employee.department_id,
      title,
      description,
      details,
      priority,
      status: "pending_approval",
      last_changed_by: employee.id,
      cc_department_ids: ccDepartmentIds,
    })
    .select("id, request_no")
    .single();
  if (error || !request) fail("/requests/new", "สร้างคำร้องไม่สำเร็จ กรุณาลองใหม่");

  let attachmentStoragePath: string | null = null;
  if (attachment) {
    const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    attachmentStoragePath = `${request.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await admin.storage
      .from("request-attachments")
      .upload(attachmentStoragePath, attachment, { contentType: attachment.type, upsert: false });
    if (uploadError) {
      await admin.from("requests").delete().eq("id", request.id);
      fail("/requests/new", "อัปโหลดไฟล์แนบไม่สำเร็จ กรุณาลองใหม่");
    }

    const { error: metadataError } = await admin.from("request_attachments").insert({
      request_id: request.id,
      uploader_id: employee.id,
      storage_path: attachmentStoragePath,
      file_name: attachment.name.slice(0, 255),
      content_type: attachment.type,
      size_bytes: attachment.size,
    });
    if (metadataError) {
      await admin.storage.from("request-attachments").remove([attachmentStoragePath]);
      await admin.from("requests").delete().eq("id", request.id);
      fail("/requests/new", "บันทึกข้อมูลไฟล์แนบไม่สำเร็จ กรุณาลองใหม่");
    }
  }

  const steps: Array<Record<string, unknown>> = [];
  if (type.uses_factory_general_chain) {
    // สายอนุมัติคงที่ตามฟอร์มจริง (เช่น PP01-FM08): ผู้จัดการโรงงาน -> ผู้จัดการทั่วไป
    // ผูกกับ "บทบาท" ไม่ผูกแผนก เหมือนใบแจ้งซ่อม (20260921080000_repair_approval_chain_...)
    // ข้ามขั้นที่ยังไม่มีคนถือบทบาทนั้น ไม่งั้นใบจะค้างโดยไม่มีใครกดอนุมัติได้เลย
    const { data: roles } = await admin.from("roles").select("id, code").in("code", ["factory_manager", "general_manager"]);
    for (const code of ["factory_manager", "general_manager"]) {
      const role = roles?.find((r) => r.code === code);
      if (!role) continue;
      const { data: holder } = await admin.from("employees").select("id").eq("role_id", role.id).eq("is_active", true).limit(1).maybeSingle();
      if (!holder) continue;
      steps.push({
        request_id: request.id,
        step_order: steps.length + 1,
        step_name: code === "factory_manager" ? "ผู้จัดการโรงงาน" : "ผู้จัดการทั่วไป",
        approver_role_id: role.id,
      });
    }
  } else {
    if (type.requires_manager_approval && employee.manager_id) {
      // An inactive manager cannot act, so that step would strand the request.
      const { data: manager } = await admin
        .from("employees")
        .select("id")
        .eq("id", employee.manager_id)
        .eq("is_active", true)
        .maybeSingle();
      if (manager) {
        steps.push({
          request_id: request.id,
          step_order: steps.length + 1,
          step_name: "หัวหน้าแผนก",
          approver_employee_id: employee.manager_id,
        });
      }
    }
    if (type.final_approver_role_id) {
      const target = await resolveApprovalTarget(type.final_approver_role_id, type.owning_department_id);
      steps.push({
        request_id: request.id,
        step_order: steps.length + 1,
        step_name: "ผู้อนุมัติหน่วยงานรับผิดชอบ",
        approver_role_id: target.roleId,
        approver_department_id: target.departmentId,
      });
    }
  }

  if (steps.length) {
    const { error: stepError } = await admin.from("approval_steps").insert(steps);
    if (stepError) {
      if (attachmentStoragePath) await admin.storage.from("request-attachments").remove([attachmentStoragePath]);
      await admin.from("requests").delete().eq("id", request.id);
      fail("/requests/new", "สร้างลำดับอนุมัติไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ");
    }

    const first = steps[0];
    let recipients: string[] = [];
    if (first.approver_employee_id) recipients = [String(first.approver_employee_id)];
    else if (first.approver_role_id) {
      let query = admin.from("employees").select("id").eq("role_id", first.approver_role_id).eq("is_active", true);
      if (first.approver_department_id) query = query.eq("department_id", first.approver_department_id);
      const { data } = await query;
      recipients = (data ?? []).map((row) => row.id);
    }
    if (recipients.length) {
      await admin.from("notifications").insert(recipients.map((recipientId) => ({
        recipient_id: recipientId,
        request_id: request.id,
        title: "มีคำร้องรออนุมัติ",
        body: `${request.request_no} · ${title}`,
        action_url: `/requests/${request.id}`,
      })));
      await Promise.allSettled(recipients.map((recipientId) =>
        notifyEmployeeByEmail(recipientId, `มีคำร้องรออนุมัติ\n${request.request_no} · ${title}`),
      ));
    }
  } else {
    await admin.from("requests").update({ status: "approved", current_step: 0 }).eq("id", request.id);
  }

  await admin.from("request_status_history").insert({
    request_id: request.id,
    from_status: null,
    to_status: "pending_approval",
    changed_by: employee.id,
    note: "สร้างและส่งคำร้อง",
  });
  revalidatePath("/");
  revalidatePath("/requests");
  redirect(`/requests/${request.id}?created=1`);
}

export async function uploadAttachmentAction(formData: FormData) {
  const employee = await getCurrentEmployee();
  const requestId = String(formData.get("request_id") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) fail(`/requests/${requestId}`, "กรุณาเลือกไฟล์");
  if (file.size > 10 * 1024 * 1024) fail(`/requests/${requestId}`, "ไฟล์ต้องมีขนาดไม่เกิน 10 MB");
  if (!allowedAttachmentTypes.has(file.type)) fail(`/requests/${requestId}`, "ชนิดไฟล์ไม่รองรับ");

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const storagePath = `${requestId}/${crypto.randomUUID()}-${safeName}`;
  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from("request-attachments")
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) fail(`/requests/${requestId}`, "อัปโหลดไฟล์ไม่สำเร็จ");

  const { error: metadataError } = await supabase.from("request_attachments").insert({
    request_id: requestId,
    uploader_id: employee.id,
    storage_path: storagePath,
    file_name: file.name.slice(0, 255),
    content_type: file.type,
    size_bytes: file.size,
  });
  if (metadataError) {
    await supabase.storage.from("request-attachments").remove([storagePath]);
    fail(`/requests/${requestId}`, "บันทึกข้อมูลไฟล์ไม่สำเร็จ");
  }
  revalidatePath(`/requests/${requestId}`);
}

export async function approvalDecisionAction(formData: FormData) {
  const employee = await getCurrentEmployee();
  const stepId = String(formData.get("step_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 1000);
  if (!new Set(["approved", "rejected", "more_info", "acknowledged"]).has(decision)) throw new Error("Invalid decision");

  const admin = createAdminClient();
  const { data: step } = await admin.from("approval_steps").select("*").eq("id", stepId).single();
  if (!step || step.status !== "pending") throw new Error("Approval step is no longer pending");
  const { data: approvalRequest } = await admin
    .from("requests")
    .select("requester_id,request_no,current_step,status")
    .eq("id", step.request_id)
    .single();
  if (!approvalRequest || approvalRequest.status !== "pending_approval" || approvalRequest.current_step !== step.step_order) {
    throw new Error("This is not the current approval step");
  }

  const roleEligible = step.approver_role_id === employee.role_id &&
    (!step.approver_department_id || step.approver_department_id === employee.department_id) &&
    await employeeHasPermission(employee.role_id, "approvals.act");
  if (step.approver_employee_id !== employee.id && !roleEligible) throw new Error("Not authorized to approve this step");

  await admin.from("approval_steps").update({
    status: decision,
    acted_by: employee.id,
    acted_at: new Date().toISOString(),
    comment: comment || null,
  }).eq("id", step.id).eq("status", "pending");

  if (decision === "rejected" || decision === "more_info" || decision === "acknowledged") {
    await admin.from("requests").update({
      status: decision,
      last_changed_by: employee.id,
    }).eq("id", step.request_id);
  } else {
    const { data: nextStep } = await admin
      .from("approval_steps")
      .select("*")
      .eq("request_id", step.request_id)
      .eq("status", "pending")
      .gt("step_order", step.step_order)
      .order("step_order")
      .limit(1)
      .maybeSingle();

    if (nextStep) {
      await admin.from("requests").update({ current_step: nextStep.step_order, last_changed_by: employee.id }).eq("id", step.request_id);
      let nextRecipients: string[] = [];
      if (nextStep.approver_employee_id) nextRecipients = [nextStep.approver_employee_id];
      else if (nextStep.approver_role_id) {
        let query = admin.from("employees").select("id").eq("role_id", nextStep.approver_role_id).eq("is_active", true);
        if (nextStep.approver_department_id) query = query.eq("department_id", nextStep.approver_department_id);
        const { data } = await query;
        nextRecipients = (data ?? []).map((row) => row.id);
      }
      if (nextRecipients.length) {
        await admin.from("notifications").insert(nextRecipients.map((recipientId) => ({
          recipient_id: recipientId,
          request_id: step.request_id,
          title: "มีคำร้องรออนุมัติ",
          body: `${approvalRequest.request_no} · ขั้นตอน ${nextStep.step_name}`,
          action_url: `/requests/${step.request_id}`,
        })));
        await Promise.allSettled(nextRecipients.map((recipientId) =>
          notifyEmployeeByEmail(recipientId, `มีคำร้องรออนุมัติ\n${approvalRequest.request_no} · ${nextStep.step_name}`),
        ));
      }
    } else {
      await admin.from("requests").update({
        status: "approved",
        approved_at: new Date().toISOString(),
        current_step: 0,
        last_changed_by: employee.id,
      }).eq("id", step.request_id);
    }
  }

  if (approvalRequest) {
    const label = decision === "approved" ? "อนุมัติขั้นตอนแล้ว"
      : decision === "rejected" ? "ไม่อนุมัติ"
      : decision === "acknowledged" ? "รับทราบข้อมูล"
      : "ขอข้อมูลเพิ่ม";
    await notifyEmployeeByEmail(approvalRequest.requester_id, `${approvalRequest.request_no} · ${label}`);
  }

  revalidatePath("/");
  revalidatePath("/approvals");
  revalidatePath(`/requests/${step.request_id}`);
}

export async function resubmitRequestAction(formData: FormData) {
  const employee = await getCurrentEmployee();
  const requestId = String(formData.get("request_id") ?? "");
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 1000) || null;
  const admin = createAdminClient();
  const { data: request } = await admin
    .from("requests")
    .select("request_no,requester_id,status")
    .eq("id", requestId)
    .single();
  if (!request || request.requester_id !== employee.id || request.status !== "more_info") {
    throw new Error("Request cannot be resubmitted");
  }

  const { data: previousStep } = await admin
    .from("approval_steps")
    .select("*")
    .eq("request_id", requestId)
    .eq("status", "more_info")
    .order("step_order", { ascending: false })
    .limit(1)
    .single();
  const { data: lastStep } = await admin
    .from("approval_steps")
    .select("step_order")
    .eq("request_id", requestId)
    .order("step_order", { ascending: false })
    .limit(1)
    .single();
  if (!previousStep || !lastStep) throw new Error("Missing approval step");

  const nextOrder = lastStep.step_order + 1;
  const carriedComment = previousStep.comment
    ? (comment ? `${previousStep.comment} | ตอบกลับ: ${comment}` : previousStep.comment)
    : (comment ? `ตอบกลับ: ${comment}` : null);
  await admin.from("approval_steps").insert({
    request_id: requestId,
    step_order: nextOrder,
    step_name: `${previousStep.step_name} (พิจารณาอีกครั้ง)`,
    approver_employee_id: previousStep.approver_employee_id,
    approver_role_id: previousStep.approver_role_id,
    approver_department_id: previousStep.approver_department_id,
    comment: carriedComment,
  });
  await admin.from("requests").update({
    status: "pending_approval",
    current_step: nextOrder,
    last_changed_by: employee.id,
  }).eq("id", requestId);

  let recipients: string[] = [];
  if (previousStep.approver_employee_id) recipients = [previousStep.approver_employee_id];
  else if (previousStep.approver_role_id) {
    let query = admin.from("employees").select("id").eq("role_id", previousStep.approver_role_id).eq("is_active", true);
    if (previousStep.approver_department_id) query = query.eq("department_id", previousStep.approver_department_id);
    const { data } = await query;
    recipients = (data ?? []).map((row) => row.id);
  }
  if (recipients.length) {
    await admin.from("notifications").insert(recipients.map((recipientId) => ({
      recipient_id: recipientId,
      request_id: requestId,
      title: "ผู้ขอส่งข้อมูลเพิ่มเติมแล้ว",
      body: `${request.request_no} พร้อมให้พิจารณาอีกครั้ง`,
      action_url: `/requests/${requestId}`,
    })));
    await Promise.allSettled(recipients.map((recipientId) =>
      notifyEmployeeByEmail(recipientId, `${request.request_no} · ผู้ขอส่งข้อมูลเพิ่มเติมแล้ว`),
    ));
  }

  revalidatePath("/");
  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
}

export async function updateRequestStatusAction(formData: FormData) {
  const employee = await getCurrentEmployee();
  const requestId = String(formData.get("request_id") ?? "");
  const nextStatus = String(formData.get("status") ?? "");
  if (!new Set(["in_progress", "completed"]).has(nextStatus)) throw new Error("Invalid operational status");
  if (!(await employeeHasPermission(employee.role_id, "requests.operate"))) throw new Error("Not authorized to operate requests");

  const admin = createAdminClient();
  const { data: request } = await admin.from("requests").select("status, assignee_id, requester_id, request_no").eq("id", requestId).single();
  if (!request || !new Set(["approved", "in_progress"]).has(request.status)) throw new Error("Request is not ready for this transition");
  if (request.assignee_id && request.assignee_id !== employee.id) throw new Error("Request is assigned to another operator");

  await admin.from("requests").update({
    status: nextStatus,
    assignee_id: request.assignee_id ?? employee.id,
    completed_at: nextStatus === "completed" ? new Date().toISOString() : null,
    last_changed_by: employee.id,
  }).eq("id", requestId);
  await notifyEmployeeByEmail(
    request.requester_id,
    `${request.request_no} · ${nextStatus === "completed" ? "ดำเนินการเสร็จแล้ว" : "เริ่มดำเนินการแล้ว"}`,
  );
  revalidatePath("/");
  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
}

export async function markAllNotificationsReadAction() {
  const employee = await getCurrentEmployee();
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", employee.id).is("read_at", null);
  revalidatePath("/notifications");
}
