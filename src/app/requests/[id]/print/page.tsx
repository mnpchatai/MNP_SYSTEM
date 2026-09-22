import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { getCurrentEmployee } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

// ส่วนที่ 3 ของฟอร์ม PP01-FM08 "สำเนาถึงแผนก" — ลำดับเดียวกับตารางในฟอร์มต้นฉบับ (6 คอลัมน์ 4 แถว)
const ccDepartmentGrid: (string | null)[][] = [
  ["PP", "BD", "QA", "RB", "GR", "PK"],
  ["PT", "BG", "SR", "SE", "ST", "WH"],
  ["MS", "MT", "FT", "IT", "EX", "SA"],
  ["PC", "HR", "AD", "AC", "SP", null],
];

function Checkbox({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span className="print-checkbox">
      <span className={`print-checkbox-box${checked ? " checked" : ""}`}>{checked ? "✓" : ""}</span>
      {label}
    </span>
  );
}

// Supabase อนุมานชนิดของความสัมพันธ์แบบฝังใน select() เป็น array เสมอเมื่อไม่มี Database
// generic type กำกับ ทั้งที่จริงเป็นแบบ to-one (ผ่าน foreign key เดี่ยว) — เหมือนที่
// request-table.tsx จัดการไว้แล้ว
function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export default async function RequestPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await getCurrentEmployee();
  const supabase = await createClient();
  const { data: request } = await supabase
    .from("requests")
    .select(`
      id, request_no, title, description, details, status, submitted_at, cc_department_ids,
      request_type:request_types(code, name_th),
      requester:employees!requests_requester_id_fkey(first_name,last_name,job_title),
      department:departments!requests_department_id_fkey(name_th),
      approval_steps(step_order, step_name, status, comment, acted_at,
        acted_by_employee:employees!approval_steps_acted_by_fkey(first_name,last_name)
      )
    `)
    .eq("id", id)
    .single();
  const requestType = firstRelation(request?.request_type);
  if (!request || requestType?.code !== "MANAGEMENT") notFound();

  const ccDepartmentIds: string[] = request.cc_department_ids ?? [];
  const { data: ccDepartments } = ccDepartmentIds.length
    ? await supabase.from("departments").select("id,code").in("id", ccDepartmentIds)
    : { data: [] as { id: string; code: string }[] };
  const ccCodes = new Set((ccDepartments ?? []).map((d) => d.code));

  const details = (request.details ?? {}) as Record<string, string>;
  const steps = [...(request.approval_steps ?? [])]
    .sort((a, b) => a.step_order - b.step_order)
    .map((step) => ({ ...step, acted_by_employee: firstRelation(step.acted_by_employee) }));
  const factoryStep = steps.find((s) => s.step_name === "ผู้จัดการโรงงาน");
  const generalStep = steps.find((s) => s.step_name === "ผู้จัดการทั่วไป");
  const comments = steps.filter((s) => s.comment).map((s) => `${s.step_name}: ${s.comment}`).join(" · ");
  const requester = firstRelation(request.requester);
  const department = firstRelation(request.department);

  return (
    <div className="print-page">
      <PrintButton />
      <div className="print-form">
        <header className="print-form-header">
          <div className="print-form-company">บริษัท เอ็ม แอนด์ พี เวิลด์ โพลิเมอร์ จำกัด</div>
          <h1>ใบคำร้องถึงฝ่ายบริหาร</h1>
          <div className="print-form-doc">
            <div>เอกสารเลขที่ {request.request_no}</div>
            <div>วันที่ออกเอกสาร {formatDate(request.submitted_at)}</div>
          </div>
        </header>

        <section className="print-form-section">
          <h2>ส่วนที่ 1 แผนก/หน่วยงาน ที่ยื่นคำร้อง</h2>
          <p><strong>เรื่อง</strong> {request.title}</p>
          <p><strong>สิ่งที่แนบมาด้วย</strong> {details.attachment_note || "—"}</p>
          <p><strong>รายละเอียด</strong></p>
          <p className="print-form-description">{request.description}</p>
          <div className="print-form-row">
            <span>ผู้ยื่นคำร้อง {requester?.first_name} {requester?.last_name}</span>
            <span>แผนก/หน่วยงาน {department?.name_th}</span>
            <span>ตำแหน่ง {requester?.job_title ?? "—"}</span>
            <span>วันที่ยื่น {formatDate(request.submitted_at)}</span>
          </div>
        </section>

        <section className="print-form-section">
          <h2>ส่วนที่ 2 ฝ่ายบริหาร</h2>
          <p><strong>มติความเห็นฝ่ายบริหาร</strong></p>
          <div className="print-form-row">
            <Checkbox checked={["approved", "in_progress", "completed"].includes(request.status)} label="อนุมัติ ดำเนินการตามคำร้อง" />
            <Checkbox checked={request.status === "rejected"} label="ไม่อนุมัติคำร้อง" />
            <Checkbox checked={request.status === "acknowledged"} label="ได้รับทราบข้อมูลที่แจ้ง" />
          </div>
          <p><strong>บันทึกข้อคิดเห็น ฝ่ายบริหาร</strong></p>
          <p className="print-form-description">{comments || "—"}</p>
          <div className="print-form-signatures">
            <div className="print-form-signature">
              <span>ลงชื่อ ____________________________ ฝ่ายบริหารโรงงาน</span>
              <span>
                {factoryStep?.acted_by_employee ? `${factoryStep.acted_by_employee.first_name} ${factoryStep.acted_by_employee.last_name} · ` : ""}
                {factoryStep?.acted_at ? formatDate(factoryStep.acted_at) : "____ / ____ / ____"}
              </span>
            </div>
            <div className="print-form-signature">
              <span>ลงชื่อ ____________________________ ผู้จัดการทั่วไป</span>
              <span>
                {generalStep?.acted_by_employee ? `${generalStep.acted_by_employee.first_name} ${generalStep.acted_by_employee.last_name} · ` : ""}
                {generalStep?.acted_at ? formatDate(generalStep.acted_at) : "____ / ____ / ____"}
              </span>
            </div>
          </div>
        </section>

        <section className="print-form-section">
          <h2>ส่วนที่ 3 สำเนาถึงแผนก</h2>
          <div className="print-form-cc-grid">
            {ccDepartmentGrid.flat().map((code, index) =>
              code === null ? (
                <Checkbox key="other" checked={Boolean(details.cc_other_note)} label={`อื่นๆ${details.cc_other_note ? `: ${details.cc_other_note}` : ""}`} />
              ) : (
                <Checkbox key={`${code}-${index}`} checked={ccCodes.has(code)} label={code} />
              ),
            )}
          </div>
        </section>

        <footer className="print-form-footer">PP01-FM08 Rev.00 14-11-24</footer>
      </div>
    </div>
  );
}
