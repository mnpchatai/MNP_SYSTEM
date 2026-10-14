import { managementModule } from "./module-mg";
import { itRepairModule } from "./module-it";
import { ncrCarModule } from "./module-ncr";
import type { RequestModule } from "./types";

export type { RequestModule } from "./types";

// โมดูลที่ใช้ฟอร์มและ flow กลางร่วมกัน
const sharedRequestModuleCodes = ["MT_REPAIR", "MANAGEMENT", "NCR_CAR"];

// โมดูลที่แยกไฟล์ไว้ใน src/lib/request-modules/
const separateRequestModules: readonly RequestModule[] = [managementModule, ncrCarModule, itRepairModule];

// ประเภทที่การพิจารณาและการส่งข้อมูลกลับเดินผ่าน RPC ของฐานข้อมูลชุดเดียวกับ Pilot Web
// (app_approval_decision / app_resubmit_request) ด้วย session ของผู้ใช้: ตรวจสิทธิ์โมดูล ล็อกแถว
// บันทึกประวัติ และแจ้งเตือนใน transaction เดียว ประเภทอื่นยังใช้เส้นทางเดิมใน approvalDecisionAction
const databaseApprovalWorkflowCodes: ReadonlySet<string> = new Set(["MT_REPAIR", "MANAGEMENT"]);

export function usesDatabaseApprovalWorkflow(code: string | null | undefined): boolean {
  return Boolean(code && databaseApprovalWorkflowCodes.has(code));
}

// มติที่ประเภทนี้เลือกได้: อนุมัติ/ไม่อนุมัติ/ขอข้อมูลเพิ่ม + มติเพิ่มของโมดูล (เช่น รับทราบข้อมูล)
export function allowedApprovalDecisions(code: string | null | undefined): ReadonlySet<string> {
  const extra = getRequestModule(code)?.extraDecisions?.map((item) => item.decision) ?? [];
  return new Set(["approved", "rejected", "more_info", ...extra]);
}

export function getRequestModule(code: string | null | undefined): RequestModule | null {
  return separateRequestModules.find((requestModule) => requestModule.code === code) ?? null;
}

export function activeRequestModuleCodes(): string[] {
  const separateCodes = separateRequestModules.filter((requestModule) => requestModule.enabled).map((requestModule) => requestModule.code);
  return [...new Set([...sharedRequestModuleCodes, ...separateCodes])];
}
