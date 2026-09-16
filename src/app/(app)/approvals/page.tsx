import Link from "next/link";
import { formatDate, priorityLabels } from "@/lib/format";
import { getCurrentEmployee } from "@/lib/auth";
import { getPendingApprovals } from "@/lib/data";

export default async function ApprovalsPage() {
  const employee = await getCurrentEmployee();
  const steps = await getPendingApprovals(employee);

  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">Approvals</div><h2>รอฉันอนุมัติ</h2><p>คำร้องที่อยู่ในขั้นตอนและขอบเขตการอนุมัติของคุณ</p></div></div>
      <section className="card">
        {!steps.length ? <div className="empty">ไม่มีคำร้องรออนุมัติ</div> : (
          <div className="table-wrap"><table><thead><tr><th>เลขที่</th><th>ผู้ขอ / เรื่อง</th><th>ขั้นตอน</th><th>ความสำคัญ</th><th>วันที่</th><th></th></tr></thead><tbody>
            {steps.map((step) => {
              const request = step.request;
              return <tr key={step.id}>
                <td><span className="request-no">{request.request_no}</span></td>
                <td><strong>{request.title}</strong><div className="muted small">{request.requester?.first_name} {request.requester?.last_name} · {request.request_type?.name_th}</div></td>
                <td>{step.step_name}</td><td className={`priority-${request.priority}`}>{priorityLabels[request.priority]}</td><td className="muted">{formatDate(request.created_at)}</td>
                <td><Link className="btn small" href={`/requests/${request.id}`}>พิจารณา</Link></td>
              </tr>;
            })}
          </tbody></table></div>
        )}
      </section>
    </>
  );
}

