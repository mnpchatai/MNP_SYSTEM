export const MODULES = [
  { id: 'dashboard', label: 'ภาพรวมโรงงาน', group: 'ภาพรวม' },
  { id: 'orders', label: 'ใบสั่งผลิต', group: 'วางแผน' },
  { id: 'recipes', label: 'สูตรยาง (BOM/PHR)', group: 'วางแผน' },
  { id: 'requisition', label: 'เบิกและชั่งวัตถุดิบ', group: 'สายการผลิต' },
  { id: 'mixing', label: '1 · ผสมยาง', group: 'สายการผลิต' },
  { id: 'extrusion', label: '2 · รีดขึ้นรูป', group: 'สายการผลิต' },
  { id: 'curing', label: '3 · อบวัลคาไนซ์', group: 'สายการผลิต' },
  { id: 'finishing', label: '4 · ตกแต่งและบรรจุ', group: 'สายการผลิต' },
  { id: 'wip', label: 'ส่งมอบ WIP', group: 'สายการผลิต' },
  { id: 'quality', label: 'QC · NCR · CoA', group: 'คุณภาพ' },
  { id: 'spc', label: 'SPC / Cpk', group: 'คุณภาพ' },
  { id: 'trace', label: 'สืบย้อนกลับ', group: 'คุณภาพ' },
  { id: 'warehouse', label: 'คลังวัตถุดิบและสินค้า', group: 'คลังและเครื่องมือ' },
  { id: 'molds', label: 'แม่พิมพ์และหัวดาย', group: 'คลังและเครื่องมือ' },
  { id: 'audit', label: 'บันทึกการใช้งาน', group: 'คลังและเครื่องมือ' },
];

const ALL = MODULES.map((m) => m.id);

export const ROLES = {
  admin: { label: 'ผู้ดูแลระบบ', modules: ALL },
  manager: { label: 'ผู้จัดการโรงงาน', modules: ALL.filter((m) => m !== 'audit') },
  planner: { label: 'ฝ่ายวางแผนการผลิต', modules: ['dashboard', 'orders', 'recipes', 'wip', 'trace', 'warehouse'] },
  store: { label: 'เจ้าหน้าที่คลัง', modules: ['dashboard', 'requisition', 'warehouse', 'wip', 'trace'] },
  mixer: { label: 'พนักงานผสมยาง', modules: ['dashboard', 'requisition', 'mixing', 'wip'] },
  extruder: { label: 'พนักงานรีดยาง', modules: ['dashboard', 'extrusion', 'wip', 'molds'] },
  curer: { label: 'พนักงานอบยาง', modules: ['dashboard', 'curing', 'wip', 'molds'] },
  finisher: { label: 'พนักงานตกแต่ง/บรรจุ', modules: ['dashboard', 'finishing', 'wip', 'warehouse'] },
  qc: { label: 'วิศวกรควบคุมคุณภาพ', modules: ['dashboard', 'recipes', 'quality', 'spc', 'trace', 'warehouse', 'molds', 'wip'] },
};

// Fine-grained permissions for actions inside modules.
export const CAN = {
  approveRecipe: ['admin', 'manager', 'qc'],
  releaseOrder: ['admin', 'manager', 'planner'],
  qcDecision: ['admin', 'manager', 'qc'],
  demoSkip: ['admin', 'manager', 'mixer', 'qc'],
};

export const can = (user, perm) => !!user && CAN[perm].includes(user.role);
export const canSee = (user, moduleId) => !!user && ROLES[user.role].modules.includes(moduleId);
