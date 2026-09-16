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

const navItems = [
  { href: "/", label: "ภาพรวม", icon: LayoutDashboard },
  { href: "/requests", label: "คำร้องทั้งหมด", icon: ClipboardList },
  { href: "/requests/new", label: "สร้างคำร้อง", icon: PlusCircle },
  { href: "/approvals", label: "รอฉันอนุมัติ", icon: CheckSquare },
  { href: "/notifications", label: "การแจ้งเตือน", icon: Bell },
  { href: "/profile", label: "ข้อมูลส่วนตัว", icon: UserCircle },
];

export function Sidebar({
  employee,
}: {
  employee: { first_name: string; last_name: string; job_title: string | null };
}) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <div className="brand-mark">M</div>
        <div>
          <strong>MNP INTERNAL</strong>
          <span>Paperless Operations</span>
        </div>
      </Link>

      <nav className="nav" aria-label="เมนูหลัก">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={`nav-link${active ? " active" : ""}`}>
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="nav-spacer" />
      <div className="sidebar-user">
        <strong>{employee.first_name} {employee.last_name}</strong>
        <span>{employee.job_title ?? "พนักงาน"}</span>
        <form action={signOutAction}>
          <button className="signout" type="submit"><LogOut size={12} /> ออกจากระบบ</button>
        </form>
      </div>
    </aside>
  );
}

