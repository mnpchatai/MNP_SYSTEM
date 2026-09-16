import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "MNP Internal System",
  description: "Paperless request and approval center for MNP employees",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" suppressHydrationWarning>
      <body>
        <Script id="mnp-theme-init" strategy="beforeInteractive">{`
          try {
            var savedTheme = localStorage.getItem('mnp-theme-v1');
            document.documentElement.dataset.theme = savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
          } catch (_) {
            document.documentElement.dataset.theme = 'light';
          }
        `}</Script>
        {children}
      </body>
    </html>
  );
}
