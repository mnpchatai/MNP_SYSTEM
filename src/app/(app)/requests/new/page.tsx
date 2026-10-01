import { RequestForm } from "@/components/request-form";
import { getCurrentEmployee } from "@/lib/auth";
import { activeRequestModuleCodes } from "@/lib/request-modules";
import { createClient } from "@/lib/supabase/server";

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ type?: string; error?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const [{ data }, { data: departments }] = await Promise.all([
    supabase
      .from("request_types")
      .select("id,code,name_th,description,form_schema")
      .eq("is_active", true)
      .in("code", activeRequestModuleCodes())
      .order("sort_order"),
    supabase.from("departments").select("id,code,name_th").eq("is_active", true),
  ]);

  // เลขที่เอกสารถัดไปของแต่ละโมดูล (อ่านอย่างเดียว) — ใบแจ้งซ่อมออกเลขตามแผนกของผู้แจ้ง
  // ถ้าอ่านไม่ได้ฟอร์มยังใช้งานได้ตามปกติ
  const employee = await getCurrentEmployee();
  const docNumbers: Record<string, string> = {};
  await Promise.all((data ?? []).map(async (type) => {
    const { data: docNumber } = type.code === "MT_REPAIR"
      ? await supabase.rpc("app_peek_repair_doc_number", { p_department_id: employee.department_id })
      : await supabase.rpc("app_peek_request_number", { p_request_type_id: type.id });
    if (typeof docNumber === "string") docNumbers[type.id] = docNumber;
  }));

  return (
    <>
      <div className="page-heading form-card">
        <div><div className="eyebrow">New Request</div><h2>สร้างคำร้องใหม่</h2><p>เลือกประเภทและให้ข้อมูลที่จำเป็น ระบบจะส่งตามลำดับอนุมัติอัตโนมัติ</p></div>
      </div>
      <section className="card form-card"><RequestForm types={data ?? []} departments={departments ?? []} docNumbers={docNumbers} initialType={params.type} error={params.error} /></section>
    </>
  );
}

