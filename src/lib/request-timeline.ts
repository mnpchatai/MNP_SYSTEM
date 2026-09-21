import { employeeName, formatDate, statusLabels } from "@/lib/format";

type TimelinePerson = { first_name: string; last_name: string } | null;

export type ApprovalTimelineRow = {
  id: string;
  step_order: number;
  step_name: string;
  status: string;
  acted_at: string | null;
  created_at: string;
  comment: string | null;
  acted_by_employee: TimelinePerson;
};

export type StatusTimelineRow = {
  id: string;
  from_status: string | null;
  to_status: string;
  created_at: string;
  note: string | null;
  changed_by_employee: TimelinePerson;
};

export type VerificationTimelineRow = {
  id: string;
  result: string;
  note: string | null;
  created_at: string;
  verifier: TimelinePerson;
};

type TimelineRequest = {
  assignee: TimelinePerson;
  work_expected_date?: string | null;
  execution_plan?: string | null;
  cause_analysis?: string | null;
  inspector_opinion?: string | null;
  parts_used?: string | null;
};

export type RequestTimelineEvent = {
  id: string;
  at: string;
  title: string;
  detail: string;
};

const repairStatusLabels: Record<string, string> = {
  ...statusLabels,
  more_info: "ต้องการข้อมูลเพิ่มเติม",
  in_progress: "กำลังซ่อม",
  pending_verify: "รอผู้แจ้งตรวจสอบผลการซ่อม",
  completed: "ซ่อมเรียบร้อย",
};

const executionPlanLabels: Record<string, string> = {
  immediate: "ดำเนินการได้ทันที",
  need_purchase: "ต้องการสั่งซื้ออุปกรณ์",
  use_existing: "ใช้อุปกรณ์ที่มีอยู่",
};

const inspectorOpinionLabels: Record<string, string> = {
  send_repair: "ส่งซ่อม",
  external: "เรียกช่างภายนอกมาซ่อม",
  self_repair: "ซ่อมเอง",
  buy_parts: "ซื้ออุปกรณ์มาทำเอง",
};

const verificationLabels: Record<string, string> = {
  pass: "ผ่าน — ใช้งานได้ปกติ",
  fail: "ไม่ผ่าน — ต้องซ่อมเพิ่มเติม",
};

function closestBy<T>(records: T[], createdAt: string, dateOf: (record: T) => string | null, predicate: (record: T) => boolean) {
  const target = Date.parse(createdAt);
  if (!Number.isFinite(target)) return null;
  const [closest] = records
    .filter(predicate)
    .map((record) => ({ record, distance: Math.abs(Date.parse(dateOf(record) ?? "") - target) }))
    .filter(({ distance }) => Number.isFinite(distance))
    .sort((left, right) => left.distance - right.distance);
  return closest && closest.distance <= 60_000 ? closest.record : null;
}

function appendNote(detail: string, note?: string | null) {
  const cleanNote = String(note ?? "").trim();
  if (!cleanNote || detail.includes(cleanNote)) return detail;
  return detail ? `${detail} · ${cleanNote}` : cleanNote;
}

export function buildRequestTimeline({
  request,
  history,
  steps,
  verifications,
  isRepair,
}: {
  request: TimelineRequest;
  history: StatusTimelineRow[];
  steps: ApprovalTimelineRow[];
  verifications: VerificationTimelineRow[];
  isRepair: boolean;
}) {
  const orderedSteps = [...steps].sort((left, right) => left.step_order - right.step_order);
  const labels = isRepair ? repairStatusLabels : statusLabels;
  const latestRepairResult = [...history]
    .filter((entry) => entry.to_status === "pending_verify")
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];

  const statusEvents: RequestTimelineEvent[] = history.map((entry) => {
    const actorName = employeeName(entry.changed_by_employee);
    const actor = actorName === "—" ? "" : actorName;
    const matchingDecision = closestBy(
      orderedSteps,
      entry.created_at,
      (step) => step.acted_at ?? step.created_at,
      (step) => {
        if (entry.to_status === "more_info") return step.status === "more_info";
        if (entry.to_status === "rejected") return step.status === "rejected";
        if (["approved", "pending_assign"].includes(entry.to_status)) return step.status === "approved";
        return false;
      },
    );
    const matchingVerification = closestBy(
      verifications,
      entry.created_at,
      (verification) => verification.created_at,
      (verification) => (
        (entry.to_status === "completed" && verification.result === "pass")
        || (entry.from_status === "pending_verify" && entry.to_status === "assigned" && verification.result === "fail")
      ),
    );

    let stage = matchingDecision?.step_name ?? "";
    if (entry.to_status === "pending_approval") {
      stage = entry.from_status === "more_info"
        ? closestBy(orderedSteps, entry.created_at, (step) => step.created_at, () => true)?.step_name ?? ""
        : orderedSteps[0]?.step_name ?? "";
    }

    let detail = "";
    if (!entry.from_status) {
      detail = `${entry.note || (isRepair ? "สร้างใบแจ้งซ่อม" : "สร้างและส่งคำร้อง")}${actor ? ` โดย ${actor}` : ""}`;
    } else if (entry.to_status === "more_info") {
      detail = `${actor || "ผู้อนุมัติ"} ขอข้อมูลเพิ่มเติม${matchingDecision?.comment ? `: ${matchingDecision.comment}` : ""}`;
    } else if (entry.to_status === "rejected") {
      detail = `${actor || "ผู้อนุมัติ"} ไม่อนุมัติ${stage ? ` ในขั้น ${stage}` : ""}${matchingDecision?.comment ? `: ${matchingDecision.comment}` : ""}`;
    } else if (entry.to_status === "pending_approval" && entry.from_status === "more_info") {
      detail = `${actor || "ผู้แจ้ง"} ส่งข้อมูลเพิ่มเติมเพื่อพิจารณาอีกครั้ง`;
    } else if (["approved", "pending_assign"].includes(entry.to_status)) {
      detail = `${actor || "ผู้อนุมัติ"} อนุมัติ${stage ? `ขั้น ${stage}` : "คำร้อง"} แล้ว`;
    } else if (entry.to_status === "assigned" && entry.from_status === "pending_verify") {
      detail = `${actor || "ผู้แจ้ง"} ตรวจรับไม่ผ่าน ส่งกลับให้ ${employeeName(request.assignee)} ซ่อมเพิ่มเติม`;
      detail = appendNote(detail, matchingVerification?.note);
    } else if (entry.to_status === "assigned") {
      detail = `${actor || "ผู้มอบหมาย"} มอบหมายงานให้ ${employeeName(request.assignee)}`;
      if (request.work_expected_date) detail += ` (กำหนดเสร็จ ${formatDate(request.work_expected_date)})`;
    } else if (entry.to_status === "in_progress") {
      detail = `${actor || "ผู้รับผิดชอบ"} ${isRepair ? "เริ่มดำเนินการซ่อม" : "รับงานและเริ่มดำเนินการ"}`;
    } else if (entry.to_status === "pending_verify") {
      detail = `${actor || "ผู้รับผิดชอบ"} ซ่อมเสร็จสิ้น ส่งให้ผู้แจ้งตรวจสอบการใช้งาน`;
      if (latestRepairResult?.id === entry.id) {
        if (request.execution_plan) detail += ` · การดำเนินงาน: ${executionPlanLabels[request.execution_plan] ?? request.execution_plan}`;
        if (request.cause_analysis) detail += ` · วิเคราะห์สาเหตุ: ${request.cause_analysis}`;
        if (request.inspector_opinion) detail += ` · ความเห็นผู้ตรวจสอบ: ${inspectorOpinionLabels[request.inspector_opinion] ?? request.inspector_opinion}`;
        if (request.parts_used) detail += ` · อะไหล่/วัสดุ: ${request.parts_used}`;
      }
    } else if (entry.to_status === "completed" && entry.from_status === "pending_verify") {
      detail = `${actor || employeeName(matchingVerification?.verifier ?? null)} ตรวจรับผลการซ่อมแล้ว: ${verificationLabels[matchingVerification?.result ?? ""] ?? "ผ่าน — ใช้งานได้ปกติ"}`;
      detail = appendNote(detail, matchingVerification?.note);
    } else if (entry.to_status === "completed") {
      detail = `${actor || "ผู้รับผิดชอบ"} ปิดงานว่าเสร็จแล้ว`;
    } else {
      detail = `${actor || "ผู้ใช้งาน"} เปลี่ยนสถานะจาก ${labels[entry.from_status] ?? entry.from_status} เป็น ${labels[entry.to_status] ?? entry.to_status}`;
    }

    return {
      id: `status-${entry.id}`,
      at: entry.created_at,
      title: `${labels[entry.to_status] ?? entry.to_status}${stage && ["pending_approval", "more_info", "rejected"].includes(entry.to_status) ? ` (${stage})` : ""}`,
      detail: appendNote(detail, entry.note),
    };
  });

  const approvalEvents: RequestTimelineEvent[] = orderedSteps.flatMap((step, index) => {
    const nextStep = orderedSteps[index + 1];
    if (step.status !== "approved" || !step.acted_at || !nextStep) return [];
    const actorName = employeeName(step.acted_by_employee);
    let detail = `${actorName === "—" ? "ผู้อนุมัติ" : actorName} อนุมัติขั้น ${step.step_name} แล้ว`;
    if (step.comment) detail += `: ${step.comment}`;
    return [{ id: `approval-${step.id}`, at: step.acted_at, title: `รออนุมัติ (${nextStep.step_name})`, detail }];
  });

  return [...statusEvents, ...approvalEvents].sort((left, right) => left.at.localeCompare(right.at));
}
