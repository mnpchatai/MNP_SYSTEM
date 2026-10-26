// รวมไฟล์ของ Pilot Web ไว้ใน dist-pilot/ ให้ Cloudflare Workers (static assets) เผยแพร่
//
// ใช้ allowlist ไม่ใช่ denylist: เผยแพร่เฉพาะสิ่งที่หน้าเว็บโหลดจริง ไฟล์อื่นใน repo
// (src/, supabase/, apps-script/, scripts/, เอกสาร) ไม่ถูกอัปโหลด แม้จะเพิ่มโฟลเดอร์ใหม่ในอนาคต
// wrangler.jsonc เรียกสคริปต์นี้ก่อน deploy ทุกครั้ง (build.command)
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-pilot");

const files = ["index.html", "app.js", "styles.css", "favicon.ico", "manifest.webmanifest"];
const dirs = ["modules", "fonts", "vendor", "icons"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const file of files) cpSync(join(root, file), join(out, file));
for (const dir of dirs) {
  // .d.ts ใน modules/ มีไว้ให้ TypeScript ฝั่ง Next.js เท่านั้น หน้าเว็บไม่ได้โหลด
  cpSync(join(root, dir), join(out, dir), { recursive: true, filter: (source) => !source.endsWith(".d.ts") });
}
// _headers ไม่ถูกเผยแพร่เป็นไฟล์ Workers อ่านไปใช้เป็นกฎ header ของ static assets
cpSync(join(root, "cloudflare", "_headers"), join(out, "_headers"));

if (!existsSync(join(out, "index.html"))) throw new Error("dist-pilot/index.html missing");
console.log(`Pilot assets ready in ${out}`);
