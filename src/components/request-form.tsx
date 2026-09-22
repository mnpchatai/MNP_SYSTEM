"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createRequestAction } from "@/app/actions/requests";
import { SubmitButton } from "@/components/submit-button";

type RequestType = {
  id: string;
  code?: string;
  name_th: string;
  description: string | null;
  form_schema: { fields?: string[] } | null;
};

type Department = { id: string; code: string; name_th: string };

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
  attachment_note: { label: "สิ่งที่แนบมาด้วย", placeholder: "ระบุรายการเอกสาร/ไฟล์ที่แนบ (ถ้ามี)" },
};

// ส่วนที่ 3 ของฟอร์ม PP01-FM08 "สำเนาถึงแผนก" — ตาราง 6 คอลัมน์ 4 แถว เรียงตามฟอร์มต้นฉบับ
// ช่องสุดท้าย (null) คือ "อื่นๆ" ซึ่งเป็นช่องข้อความอิสระ ไม่ใช่แผนกในระบบ
const ccDepartmentGrid: (string | null)[][] = [
  ["PP", "BD", "QA", "RB", "GR", "PK"],
  ["PT", "BG", "SR", "SE", "ST", "WH"],
  ["MS", "MT", "FT", "IT", "EX", "SA"],
  ["PC", "HR", "AD", "AC", "SP", null],
];

export function RequestForm({ types, departments, initialType, error }: { types: RequestType[]; departments: Department[]; initialType?: string; error?: string }) {
  const [selectedId, setSelectedId] = useState(initialType && types.some((t) => t.id === initialType) ? initialType : types[0]?.id ?? "");
  const selected = useMemo(() => types.find((t) => t.id === selectedId), [selectedId, types]);
  const fields = selected?.form_schema?.fields ?? [];

  return (
    <form action={createRequestAction} encType="multipart/form-data">
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
        <div className="field full">
          <label htmlFor="attachment">ไฟล์แนบ (ถ้ามี)</label>
          <input className="input" id="attachment" name="attachment" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.docx,.xlsx" />
          <small>สูงสุด 10 MB · JPG, PNG, WebP, PDF, TXT, DOCX, XLSX</small>
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

      {selected?.code === "MANAGEMENT" && (
        <div className="field full cc-department-field">
          <label>สำเนาถึงแผนก</label>
          <div className="cc-department-grid">
            {ccDepartmentGrid.flat().map((code, index) => {
              if (code === null) {
                return (
                  <label className="cc-department-other" key="other">
                    <span>อื่นๆ</span>
                    <input className="input" name="cc_other_note" placeholder="ระบุ" maxLength={200} />
                  </label>
                );
              }
              const department = departments.find((d) => d.code === code);
              if (!department) return <span key={`${code}-${index}`} />;
              return (
                <label className="cc-department-option" key={department.id}>
                  <input type="checkbox" name="cc_department_ids" value={department.id} />
                  <span>{code}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="form-actions">
        <Link className="btn secondary" href="/requests">ยกเลิก</Link>
        <SubmitButton pendingLabel="กำลังส่งคำร้อง...">ส่งคำร้อง</SubmitButton>
      </div>
    </form>
  );
}

