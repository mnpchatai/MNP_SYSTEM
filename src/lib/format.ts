export const statusLabels: Record<string, string> = {
  draft: "แบบร่าง",
  pending_approval: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  in_progress: "กำลังดำเนินการ",
  more_info: "ขอข้อมูลเพิ่ม",
  completed: "เสร็จแล้ว",
  rejected: "ไม่อนุมัติ",
  cancelled: "ยกเลิก",
  pending_assign: "รอมอบหมายช่าง",
  assigned: "รอดำเนินการ",
  pending_verify: "รอผู้แจ้งตรวจสอบ",
};

export const priorityLabels: Record<string, string> = {
  low: "ต่ำ",
  normal: "ปกติ",
  high: "สูง",
  urgent: "เร่งด่วน",
};

export function formatDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

export function employeeName(employee: { first_name: string; last_name: string } | null) {
  return employee ? `${employee.first_name} ${employee.last_name}` : "—";
}


export function formatFileSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}
