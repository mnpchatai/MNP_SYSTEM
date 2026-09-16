"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createRequestAction } from "@/app/actions/requests";
import { SubmitButton } from "@/components/submit-button";

type RequestType = {
  id: string;
  name_th: string;
  description: string | null;
  form_schema: { fields?: string[] } | null;
};

const fieldMeta: Record<string, { label: string; type?: string; placeholder?: string }> = {
  asset_code: { label: "รหัสเครื่อง/ทรัพย์สิน", placeholder: "เช่น CV-012" },
  location: { label: "สถานที่", placeholder: "อาคาร / พื้นที่" },
  preferred_date: { label: "วันที่สะดวก", type: "date" },
  impact: { label: "ผลกระทบ", placeholder: "กระทบงานหรือผู้ใช้กี่คน" },
  vehicle_no: { label: "ทะเบียน/หมายเลขรถ" },
  odometer: { label: "เลขไมล์", type: "number" },
  estimated_cost: { label: "งบประมาณโดยประมาณ (บาท)", type: "number" },
  required_date: { label: "วันที่ต้องการใช้", type: "date" },
  vendor: { label: "ผู้ขายที่เสนอ (ถ้ามี)" },
  business_reason: { label: "เหตุผลทางธุรกิจ" },
  system_name: { label: "ชื่อระบบ" },
  access_level: { label: "ระดับสิทธิ์ที่ต้องการ" },
  leave_type: { label: "ประเภทการลา", placeholder: "ลาป่วย / ลากิจ / ลาพักร้อน" },
  start_date: { label: "วันที่เริ่ม", type: "date" },
  end_date: { label: "วันที่สิ้นสุด", type: "date" },
  course_name: { label: "ชื่อหลักสูตร" },
  provider: { label: "ผู้จัดอบรม" },
};

export function RequestForm({ types, initialType, error }: { types: RequestType[]; initialType?: string; error?: string }) {
  const [selectedId, setSelectedId] = useState(initialType && types.some((t) => t.id === initialType) ? initialType : types[0]?.id ?? "");
  const selected = useMemo(() => types.find((t) => t.id === selectedId), [selectedId, types]);
  const fields = selected?.form_schema?.fields ?? [];

  return (
    <form action={createRequestAction}>
      {error && <div className="form-message error">{error}</div>}
      <div className="form-grid">
        <div className="field full">
          <label htmlFor="request_type_id">ประเภทคำร้อง</label>
          <select className="select" id="request_type_id" name="request_type_id" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} required>
            {types.map((type) => <option value={type.id} key={type.id}>{type.name_th}</option>)}
          </select>
          <small>{selected?.description}</small>
        </div>
        <div className="field full">
          <label htmlFor="title">หัวข้อ</label>
          <input className="input" id="title" name="title" minLength={3} maxLength={200} placeholder="สรุปสิ่งที่ต้องการให้กระชับ" required />
        </div>
        <div className="field full">
          <label htmlFor="description">รายละเอียด</label>
          <textarea className="textarea" id="description" name="description" minLength={3} maxLength={5000} placeholder="อธิบายปัญหา ความต้องการ หรือเหตุผลประกอบ" required />
        </div>
        <div className="field">
          <label htmlFor="priority">ความสำคัญ</label>
          <select className="select" id="priority" name="priority" defaultValue="normal">
            <option value="low">ต่ำ</option><option value="normal">ปกติ</option><option value="high">สูง</option><option value="urgent">เร่งด่วน</option>
          </select>
        </div>
        {fields.map((name) => {
          const meta = fieldMeta[name];
          if (!meta) return null;
          return (
            <div className="field" key={name}>
              <label htmlFor={name}>{meta.label}</label>
              <input className="input" id={name} name={name} type={meta.type ?? "text"} placeholder={meta.placeholder} />
            </div>
          );
        })}
      </div>
      <div className="form-actions">
        <Link className="btn secondary" href="/requests">ยกเลิก</Link>
        <SubmitButton pendingLabel="กำลังส่งคำร้อง...">ส่งคำร้อง</SubmitButton>
      </div>
    </form>
  );
}

