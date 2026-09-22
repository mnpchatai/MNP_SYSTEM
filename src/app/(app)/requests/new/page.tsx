import { RequestForm } from "@/components/request-form";
import { createClient } from "@/lib/supabase/server";

const requestModuleCodes = ["MT_REPAIR", "MANAGEMENT", "NCR_CAR"];

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ type?: string; error?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const [{ data }, { data: departments }] = await Promise.all([
    supabase
      .from("request_types")
      .select("id,code,name_th,description,form_schema")
      .eq("is_active", true)
      .in("code", requestModuleCodes)
      .order("sort_order"),
    supabase.from("departments").select("id,code,name_th").eq("is_active", true),
  ]);

  return (
    <>
      <div className="page-heading form-card">
        <div><div className="eyebrow">New Request</div><h2>สร้างคำร้องใหม่</h2><p>เลือกประเภทและให้ข้อมูลที่จำเป็น ระบบจะส่งตามลำดับอนุมัติอัตโนมัติ</p></div>
      </div>
      <section className="card form-card"><RequestForm types={data ?? []} departments={departments ?? []} initialType={params.type} error={params.error} /></section>
    </>
  );
}

