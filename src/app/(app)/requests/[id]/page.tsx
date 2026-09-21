import { Paperclip } from "lucide-react";
import { notFound } from "next/navigation";
import {
  approvalDecisionAction,
  resubmitRequestAction,
  updateRequestStatusAction,
  uploadAttachmentAction,
} from "@/app/actions/requests";
import { AttachmentGallery, type AttachmentItem } from "@/components/attachment-gallery";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { getCurrentEmployee } from "@/lib/auth";
import { employeeName, formatDate, priorityLabels, statusLabels } from "@/lib/format";
import { hasPermission } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

const detailLabels: Record<string, string> = {
  asset_code: "รหัสเครื่อง/ทรัพย์สิน", location: "สถานที่", preferred_date: "วันที่สะดวก",
  impact: "ผลกระทบ", vehicle_no: "ทะเบียน/หมายเลขรถ", odometer: "เลขไมล์",
  estimated_cost: "งบประมาณโดยประมาณ", required_date: "วันที่ต้องการใช้", vendor: "ผู้ขาย",
  business_reason: "เหตุผลทางธุรกิจ", system_name: "ชื่อระบบ", access_level: "ระดับสิทธิ์",
  leave_type: "ประเภทการลา", start_date: "วันที่เริ่ม", end_date: "วันที่สิ้นสุด",
  course_name: "ชื่อหลักสูตร", provider: "ผู้จัดอบรม",
};

export default async function RequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const { id } = await params;
  const messages = await searchParams;
  const employee = await getCurrentEmployee();
  const supabase = await createClient();
  const { data: request } = await supabase
    .from("requests")
    .select(`
      *,
      request_type:request_types(name_th, code),
      requester:employees!requests_requester_id_fkey(first_name,last_name,employee_no),
      assignee:employees!requests_assignee_id_fkey(first_name,last_name),
      approval_steps(*,
        approver:employees!approval_steps_approver_employee_id_fkey(first_name,last_name),
        acted_by_employee:employees!approval_steps_acted_by_fkey(first_name,last_name)
      ),
      request_attachments(*),
      request_status_history(*, changed_by_employee:employees!request_status_history_changed_by_fkey(first_name,last_name))
    `)
    .eq("id", id)
    .single();
  if (!request) notFound();

  const canOperate = await hasPermission(employee.role_id, "requests.operate");
  const pendingStep = [...(request.approval_steps ?? [])]
    .sort((a, b) => a.step_order - b.step_order)
    .find((step) => step.status === "pending" && step.step_order === request.current_step && (
      step.approver_employee_id === employee.id ||
      (step.approver_role_id === employee.role_id && (!step.approver_department_id || step.approver_department_id === employee.department_id))
    ));
  const details = (request.details ?? {}) as Record<string, string>;

  return (
    <>
      {messages.created && <div className="form-message success">สร้างและส่งคำร้องเรียบร้อยแล้ว</div>}
      {messages.error && <div className="form-message error">{messages.error}</div>}
      <section className="detail-header">
        <div className="detail-header-top">
          <div>
            <span className="request-no">{request.request_no}</span>
            <h2>{request.title}</h2>
            <p>{request.request_type?.name_th} · ผู้ขอ {employeeName(request.requester)}</p>
          </div>
          <StatusBadge status={request.status} />
        </div>
      </section>

      <div className="detail-grid">
        <div className="stack">
          <section className="card">
            <div className="card-title"><h3>รายละเอียดคำร้อง</h3></div>
            <p className="description">{request.description}</p>
            <dl className="definition-grid" style={{ marginTop: 18 }}>
              <div className="definition"><dt>ความสำคัญ</dt><dd className={`priority-${request.priority}`}>{priorityLabels[request.priority]}</dd></div>
              <div className="definition"><dt>วันที่ส่ง</dt><dd>{formatDate(request.submitted_at, true)}</dd></div>
              {Object.entries(details).map(([key, value]) => (
                <div className="definition" key={key}><dt>{detailLabels[key] ?? key}</dt><dd>{value}</dd></div>
              ))}
              <div className="definition"><dt>ผู้รับผิดชอบ</dt><dd>{employeeName(request.assignee)}</dd></div>
            </dl>
          </section>

          {request.status === "more_info" && (() => {
            const moreInfoStep = [...(request.approval_steps ?? [])]
              .sort((a, b) => b.step_order - a.step_order)
              .find((step) => step.status === "more_info");
            const requesterLabel = employeeName(request.requester);
            const isRequester = request.requester_id === employee.id;
            return (
              <section className="card more-info-card">
                <div className="card-title"><h3>รอข้อมูลเพิ่มเติมจาก {requesterLabel}</h3></div>
                <p className="muted small">
                  {moreInfoStep?.acted_by_employee ? employeeName(moreInfoStep.acted_by_employee) : "ผู้อนุมัติ"} ขอข้อมูลเพิ่มเติมในขั้นตอน &quot;{moreInfoStep?.step_name ?? "—"}&quot;
                  {moreInfoStep?.comment ? ` · ${moreInfoStep.comment}` : ""}
                </p>
                {!isRequester && <p className="muted small">มีเพียง {requesterLabel} ผู้ยื่นคำร้องนี้เท่านั้นที่ตอบกลับได้</p>}
              </section>
            );
          })()}

          {pendingStep && request.status === "pending_approval" && (
            <section className="card">
              <div className="card-title"><h3>พิจารณาคำร้อง</h3><span className="badge pending_approval">{pendingStep.step_name}</span></div>
              <form action={approvalDecisionAction}>
                <input type="hidden" name="step_id" value={pendingStep.id} />
                <div className="field"><label htmlFor="comment">ความเห็นประกอบ</label><textarea className="textarea" id="comment" name="comment" maxLength={1000} placeholder="ระบุเหตุผล โดยเฉพาะเมื่อไม่อนุมัติหรือขอข้อมูลเพิ่ม" /></div>
                <div className="form-actions">
                  <button className="btn danger" name="decision" value="rejected">ไม่อนุมัติ</button>
                  <button className="btn warning" name="decision" value="more_info">ขอข้อมูลเพิ่ม</button>
                  <button className="btn success" name="decision" value="approved">อนุมัติ</button>
                </div>
              </form>
            </section>
          )}

          {request.status === "more_info" && request.requester_id === employee.id && (
            <section className="card">
              <div className="card-title"><h3>ส่งข้อมูลกลับเพื่อพิจารณา</h3></div>
              <p className="muted small">แนบไฟล์ด้านล่างเพิ่มได้ถ้าจำเป็น แล้วระบุข้อมูลที่ขอเพิ่มเติมก่อนส่งคำร้องกลับไปยังผู้อนุมัติ</p>
              <form action={resubmitRequestAction}>
                <input type="hidden" name="request_id" value={request.id} />
                <div className="field"><label htmlFor="resubmit-comment">ข้อมูลเพิ่มเติม</label><textarea className="textarea" id="resubmit-comment" name="comment" maxLength={1000} placeholder="ระบุข้อมูลที่ขอเพิ่มเติม" /></div>
                <SubmitButton pendingLabel="กำลังส่งกลับ...">ส่งให้พิจารณาอีกครั้ง</SubmitButton>
              </form>
            </section>
          )}

          {canOperate && ["approved", "in_progress"].includes(request.status) && (!request.assignee_id || request.assignee_id === employee.id) && (
            <section className="card">
              <div className="card-title"><h3>ดำเนินงาน</h3></div>
              <form className="inline-form" action={updateRequestStatusAction}>
                <input type="hidden" name="request_id" value={request.id} />
                {request.status === "approved" ? (
                  <button className="btn" name="status" value="in_progress">รับงานและเริ่มดำเนินการ</button>
                ) : (
                  <button className="btn success" name="status" value="completed">ปิดงานว่าเสร็จแล้ว</button>
                )}
              </form>
            </section>
          )}
        </div>

        <aside className="stack">
          <section className="card">
            <div className="card-title"><h3>ลำดับอนุมัติ</h3></div>
            <div className="timeline">
              {[...(request.approval_steps ?? [])].sort((a, b) => a.step_order - b.step_order).map((step) => (
                <div className="timeline-item" key={step.id}>
                  <span className="timeline-dot" style={{ background: step.status === "approved" ? "var(--success)" : step.status === "rejected" ? "var(--danger)" : undefined }} />
                  <strong>{step.step_name}</strong>
                  <p>{employeeName(step.approver)} · {step.status === "pending" ? "รอดำเนินการ" : statusLabels[step.status] ?? step.status}</p>
                  {step.comment && <p>“{step.comment}”</p>}
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-title"><h3><Paperclip size={16} /> ไฟล์แนบ</h3></div>
            <div className="stack">
              <AttachmentGallery attachments={(request.request_attachments ?? []) as AttachmentItem[]} />
              <form action={uploadAttachmentAction} className="stack" encType="multipart/form-data">
                <input type="hidden" name="request_id" value={request.id} />
                <input className="input" type="file" name="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.docx,.xlsx" required />
                <SubmitButton className="btn secondary small" pendingLabel="กำลังอัปโหลด...">อัปโหลดไฟล์</SubmitButton>
              </form>
              <span className="muted" style={{ fontSize: 10 }}>สูงสุด 10 MB · JPG, PNG, WebP, PDF, TXT, DOCX, XLSX</span>
            </div>
          </section>

          <section className="card">
            <div className="card-title"><h3>ประวัติสถานะ</h3></div>
            <div className="timeline">
              {[...(request.request_status_history ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((entry) => (
                <div className="timeline-item" key={entry.id}>
                  <span className="timeline-dot" />
                  <strong>{statusLabels[entry.to_status]}</strong>
                  <p>{employeeName(entry.changed_by_employee)} · {formatDate(entry.created_at, true)}</p>
                  {entry.note && <p>{entry.note}</p>}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
