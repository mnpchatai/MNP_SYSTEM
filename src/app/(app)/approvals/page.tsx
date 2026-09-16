import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3 } from "lucide-react";
import { getCurrentEmployee } from "@/lib/auth";
import { getPendingApprovals } from "@/lib/data";
import { formatDate, priorityLabels } from "@/lib/format";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const employee = await getCurrentEmployee();
  const { request: selectedRequestId } = await searchParams;
  const steps = await getPendingApprovals(employee);
  const selectedStep = steps.find((step) => step.request.id === selectedRequestId) ?? steps[0];

  if (!steps.length) {
    return (
      <section className="approval-empty">
        <span><CheckCircle2 size={22} aria-hidden="true" /></span>
        <h1>ไม่มีคำร้องรออนุมัติ</h1>
        <p>รายการใหม่ที่อยู่ในขอบเขตการอนุมัติของคุณจะแสดงที่หน้านี้</p>
        <Link className="btn secondary" href="/">กลับหน้าหลัก</Link>
      </section>
    );
  }

  const selectedRequest = selectedStep.request;

  return (
    <div className="approval-workspace">
      <section className="approval-queue">
        <div className="approval-queue-heading">
          <div><h1>รอฉันอนุมัติ <span>{steps.length}</span></h1><p>เรียงตามรายการที่รอนานที่สุด</p></div>
        </div>
        <div className="approval-tabs"><span className="active">ทั้งหมด</span><span>เร่งด่วน</span></div>
        <div className="approval-list">
          {steps.map((step) => {
            const request = step.request;
            const active = request.id === selectedRequest.id;
            return (
              <Link className={`approval-list-row${active ? " active" : ""}`} href={`/approvals?request=${request.id}`} key={step.id}>
                <div className="approval-row-top"><span>{request.request_no}</span><time>{formatDate(request.created_at)}</time></div>
                <strong>{request.title}</strong>
                <p>{request.requester?.first_name} {request.requester?.last_name} · {request.request_type?.name_th}</p>
                <div className="approval-row-bottom"><span className={`priority-chip ${request.priority}`}>{priorityLabels[request.priority]}</span><span>{step.step_name}</span></div>
              </Link>
            );
          })}
        </div>
      </section>

      <article className="approval-preview">
        <div className="approval-preview-inner">
          <div className="approval-kicker">
            <span>{selectedRequest.request_no}</span>
            <span className="badge pending_approval"><Clock3 size={11} aria-hidden="true" /> รออนุมัติ</span>
          </div>
          <h2>{selectedRequest.title}</h2>
          <div className="requester-line">
            <span className="requester-avatar">{selectedRequest.requester?.first_name?.at(0)}{selectedRequest.requester?.last_name?.at(0)}</span>
            <div><strong>{selectedRequest.requester?.first_name} {selectedRequest.requester?.last_name}</strong><span>{selectedRequest.request_type?.name_th} · ส่งเมื่อ {formatDate(selectedRequest.submitted_at, true)}</span></div>
          </div>

          <section className="preview-section">
            <h3>ข้อมูลคำร้อง</h3>
            <dl className="preview-fields">
              <div><dt>ประเภทคำร้อง</dt><dd>{selectedRequest.request_type?.name_th}</dd></div>
              <div><dt>ความสำคัญ</dt><dd className={`priority-${selectedRequest.priority}`}>{priorityLabels[selectedRequest.priority]}</dd></div>
              <div><dt>ขั้นตอนปัจจุบัน</dt><dd>{selectedStep.step_name}</dd></div>
              <div><dt>วันที่ส่ง</dt><dd>{formatDate(selectedRequest.submitted_at, true)}</dd></div>
            </dl>
            <p className="preview-description">{selectedRequest.description}</p>
          </section>

          <section className="preview-section">
            <h3>ขั้นตอนที่ต้องดำเนินการ</h3>
            <div className="current-approval-step">
              <span>1</span>
              <div><strong>{selectedStep.step_name}</strong><p>ตรวจสอบรายละเอียดและบันทึกผลการพิจารณา</p></div>
            </div>
          </section>
        </div>
        <div className="approval-actionbar">
          <Link className="btn" href={`/requests/${selectedRequest.id}`}>เปิดคำร้องและพิจารณา <ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
      </article>
    </div>
  );
}
