#!/usr/bin/env bash
# ตรวจกติกาที่ git merge ตรวจให้ไม่ได้ เมื่อหลาย PR เปิดพร้อมกัน
# ใช้: scripts/ci/check-pr-guards.sh <base-ref>   เช่น origin/main
set -euo pipefail

base_ref="${1:?usage: check-pr-guards.sh <base-ref>}"
merge_base="$(git merge-base "$base_ref" HEAD)"
failed=0

fail() {
  echo "::error::$1"
  failed=1
}

# 1) ไฟล์ของ Pilot Web ใน index.html (app.js, styles.css, modules/*.js) ต้องใช้ ?v= ชุดเดียวกัน
js_version="$(grep -o 'app\.js?v=[^"]*' index.html | head -n1 | cut -d= -f2)"
css_version="$(grep -o 'styles\.css?v=[^"]*' index.html | head -n1 | cut -d= -f2)"
if [[ -z "$js_version" || "$js_version" != "$css_version" ]]; then
  fail "index.html: ?v= ของ app.js ($js_version) และ styles.css ($css_version) ต้องตรงกัน"
fi
while IFS= read -r module_ref; do
  [[ -z "$module_ref" ]] && continue
  if [[ "${module_ref##*\?v=}" != "$js_version" ]]; then
    fail "index.html: ?v= ของ ${module_ref%%\?*} ต้องตรงกับ app.js ($js_version)"
  fi
done < <(grep -o 'modules/[^"]*\.js?v=[^"]*' index.html || true)
while IFS= read -r module_file; do
  [[ -z "$module_file" ]] && continue
  if ! grep -q "\./$module_file?v=" index.html; then
    fail "$module_file: ยังไม่ได้โหลดใน index.html (ต้องมี <script defer> พร้อม ?v= ก่อน app.js)"
  fi
done < <(git ls-files modules/ 2>/dev/null | grep '\.js$' || true)

# 2) แก้ app.js, styles.css หรือ modules/ แล้วต้องเลื่อน ?v= ให้ต่างจาก base
if ! git diff --quiet "$merge_base" HEAD -- app.js styles.css modules; then
  base_version="$(git show "$base_ref:index.html" | grep -o 'app\.js?v=[^"]*' | head -n1 | cut -d= -f2)"
  if [[ "$js_version" == "$base_version" ]]; then
    fail "แก้ app.js/styles.css/modules แต่ยังไม่ได้เลื่อน ?v= ใน index.html (ยังเป็น $base_version เท่ากับ $base_ref)"
  fi
fi

# 3) ห้ามแก้/ลบ/เปลี่ยนชื่อ migration ที่อยู่ใน base แล้ว (อาจถูก apply ไปแล้ว)
changed_existing="$(git diff --name-only --diff-filter=MDR "$merge_base" HEAD -- supabase/migrations)"
if [[ -n "$changed_existing" ]]; then
  fail "ห้ามแก้ migration ที่มีอยู่แล้ว ให้เพิ่มไฟล์ใหม่แทน: $(echo "$changed_existing" | tr '\n' ' ')"
fi

# 4) migration ใหม่ต้องมี timestamp ใหม่กว่า migration ล่าสุดบน base
#    (กัน PR ที่แตกมาก่อนแล้ว merge ทีหลัง ทำให้ลำดับ apply สลับกัน)
latest_base="$(git ls-tree --name-only "$base_ref" supabase/migrations/ | xargs -n1 basename | sort | tail -n1)"
latest_base_ts="${latest_base%%_*}"
while IFS= read -r added; do
  [[ -z "$added" ]] && continue
  name="$(basename "$added")"
  ts="${name%%_*}"
  if [[ ! "$ts" =~ ^[0-9]{14}$ ]]; then
    fail "$name: ชื่อไฟล์ต้องขึ้นต้นด้วย timestamp 14 หลัก (YYYYMMDDHHMMSS_)"
  elif [[ "$ts" < "$latest_base_ts" || "$ts" == "$latest_base_ts" ]]; then
    fail "$name: timestamp ต้องใหม่กว่า migration ล่าสุดบน $base_ref ($latest_base) ให้เปลี่ยนชื่อไฟล์ก่อน merge"
  fi
done < <(git diff --name-only --diff-filter=A "$merge_base" HEAD -- supabase/migrations)

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
echo "PR guards passed"
