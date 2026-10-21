#!/usr/bin/env bash
# อ่านรายชื่อไฟล์ที่ PR เปลี่ยน (บรรทัดละไฟล์) จาก stdin แล้วพิมพ์ true ถ้า job "Database tests" ต้องรันทั้งชุด ไม่งั้นพิมพ์ false
# ใช้ใน .github/workflows/ci.yml เพื่อข้ามขั้นเปิด Supabase stack (~2 นาที) ใน PR ที่ไม่แตะสิ่งที่ db:test / test:storage พึ่งพา
#   git diff --name-only <merge-base> HEAD | scripts/ci/needs-db-tests.sh
# ผิดพลาดแล้วต้องไม่ข้าม: ถ้า grep ล้มเหลว (ไม่ใช่แค่ "ไม่พบ") สคริปต์จบด้วย exit code ไม่เป็นศูนย์ ซึ่งทำให้ job ล้ม
set -euo pipefail

# supabase/            migration, seed, config, tests ของ db:test (รวม functions เพื่อความปลอดภัย)
# package*.json, .nvmrc  เวอร์ชัน supabase CLI, supabase-js และ node ที่ใช้รัน
# ncr-storage...mjs    ตัวทดสอบของ test:storage (สคริปต์เดียว ไม่ import จากโค้ดแอป)
# ci.yml, ไฟล์นี้       แก้การตั้งค่าตัวกรองแล้วต้องรันจริงเพื่อพิสูจน์
pattern='^(supabase/|package(-lock)?\.json$|\.nvmrc$|\.github/workflows/ci\.yml$|scripts/ci/needs-db-tests\.sh$|scripts/tests/ncr-storage\.integration\.mjs$)'

status=0
grep -Eq "$pattern" || status=$?
case "$status" in
  0) echo true ;;
  1) echo false ;;
  *) exit "$status" ;;
esac
