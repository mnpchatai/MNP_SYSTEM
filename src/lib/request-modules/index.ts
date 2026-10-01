import { managementModule } from "./module-mg";
import { itRepairModule } from "./module-it";
import type { RequestModule } from "./types";

export type { RequestModule } from "./types";

// โมดูลที่ใช้ฟอร์มและ flow กลางร่วมกัน
const sharedRequestModuleCodes = ["MT_REPAIR", "MANAGEMENT", "NCR_CAR"];

// โมดูลที่แยกไฟล์ไว้ใน src/lib/request-modules/
const separateRequestModules: readonly RequestModule[] = [managementModule, itRepairModule];

export function getRequestModule(code: string | null | undefined): RequestModule | null {
  return separateRequestModules.find((requestModule) => requestModule.code === code) ?? null;
}

export function activeRequestModuleCodes(): string[] {
  const separateCodes = separateRequestModules.filter((requestModule) => requestModule.enabled).map((requestModule) => requestModule.code);
  return [...new Set([...sharedRequestModuleCodes, ...separateCodes])];
}
