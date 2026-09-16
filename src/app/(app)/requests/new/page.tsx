import { RequestForm } from "@/components/request-form";
import { createClient } from "@/lib/supabase/server";

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ type?: string; error?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("request_types").select("id,name_th,description,form_schema").eq("is_active", true).order("sort_order");

  return (
    <>
      <div className="page-heading form-card">
        <div><div className="eyebrow">New Request</div><h2>สร้างคำร้องใหม่</h2><p>เลือกประเภทและให้ข้อมูลที่จำเป็น ระบบจะส่งตามลำดับอนุมัติอัตโนมัติ</p></div>
      </div>
      <section className="card form-card"><RequestForm types={data ?? []} initialType={params.type} error={params.error} /></section>
    </>
  );
}

