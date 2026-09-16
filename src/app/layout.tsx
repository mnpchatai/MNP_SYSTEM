import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MNP Internal System",
  description: "Paperless request and approval center for MNP employees",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}

