"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CheckSquare,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  PlusCircle,
  UserCircle,
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth";

const workspaceItems = [
  { href: "/", label: "หน้าหลัก", icon: LayoutDashboard },
  { href: "/requests", label: "คำร้องของฉัน", icon: ClipboardList },
  { href: "/requests/new", label: "สร้างคำร้อง", icon: PlusCircle },
  { href: "/approvals", label: "รอฉันอนุมัติ", icon: CheckSquare },
  { href: "/notifications", label: "การแจ้งเตือน", icon: Bell },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/requests") {
    return pathname === "/requests" || (pathname.startsWith("/requests/") && !pathname.startsWith("/requests/new"));
  }
  return pathname.startsWith(href);
}

export function Sidebar({
  employee,
}: {
  employee: { first_name: string; last_name: string; job_title: string | null };
}) {
  const pathname = usePathname();
  const initials = `${employee.first_name.at(0) ?? ""}${employee.last_name.at(0) ?? ""}`;

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <div className="brand-mark">M</div>
        <div>
          <strong>MNP Workspace</strong>
          <span>INTERNAL OPERATIONS</span>
        </div>
      </Link>

      <nav className="nav" aria-label="เมนูหลัก">
        <div className="nav-section-label">Workspace</div>
        {workspaceItems.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`nav-link${isActivePath(pathname, href) ? " active" : ""}`}>
            <Icon size={17} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}

        <div className="nav-divider" />
        <div className="nav-section-label">Account</div>
        <Link href="/profile" className={`nav-link${pathname.startsWith("/profile") ? " active" : ""}`}>
          <UserCircle size={17} aria-hidden="true" />
          <span>ข้อมูลส่วนตัว</span>
        </Link>
      </nav>

      <div className="nav-spacer" />
      <div className="sidebar-user">
        <div className="sidebar-avatar">{initials}</div>
        <div className="sidebar-user-copy">
          <strong>{employee.first_name} {employee.last_name}</strong>
          <span>{employee.job_title ?? "พนักงาน"}</span>
        </div>
        <form action={signOutAction}>
          <button className="signout" type="submit" aria-label="ออกจากระบบ" title="ออกจากระบบ">
            <LogOut size={15} aria-hidden="true" />
          </button>
        </form>
      </div>
    </aside>
  );
}
