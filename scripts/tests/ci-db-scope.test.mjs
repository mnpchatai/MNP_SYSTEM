// ตรวจตัวกรองที่ทำให้ job "Database tests" ข้ามขั้นช้าใน PR ที่ไม่แตะสิ่งที่ db:test / test:storage พึ่งพา
//   - scripts/ci/needs-db-tests.sh ตอบ true/false ถูกตามรายชื่อไฟล์ที่เปลี่ยน
//   - .github/workflows/ci.yml เดินสายไว้ครบ: ทุกขั้นหลัง step "scope" ผูกกับผลของมัน และขั้น stop ยังรันแม้ขั้นก่อนล้ม
//     ส่วน job "app" ไม่มีเงื่อนไขข้ามเลย (typecheck/lint/unit/build รันทุก PR)
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { load } from "js-yaml";

const script = fileURLToPath(new URL("../ci/needs-db-tests.sh", import.meta.url));
const workflowPath = new URL("../../.github/workflows/ci.yml", import.meta.url);

function needsDbTests(files) {
  const result = spawnSync(script, [], { input: files.join("\n"), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("script is executable because CI calls it directly", () => {
  assert.ok(statSync(script).mode & 0o111, "chmod +x scripts/ci/needs-db-tests.sh");
});

test("anything the database tests depend on turns them on", () => {
  const dependencies = [
    "supabase/migrations/20261021010000_x.sql",
    "supabase/tests/database/x.test.sql",
    "supabase/seed.sql",
    "supabase/config.toml",
    "supabase/functions/x/index.ts",
    "package.json",
    "package-lock.json",
    ".nvmrc",
    ".github/workflows/ci.yml",
    "scripts/ci/needs-db-tests.sh",
    "scripts/tests/ncr-storage.integration.mjs",
  ];
  for (const file of dependencies) {
    assert.equal(needsDbTests([file]), "true", file);
  }
});

test("pilot, app, docs and agent changes alone leave them off", () => {
  const unrelated = [
    "index.html",
    "app.js",
    "styles.css",
    "modules/module-ncr.js",
    "src/app/page.tsx",
    "src/lib/supabase/server.ts",
    "apps-script/FormFill.gs",
    "README.md",
    "CLAUDE.md",
    ".claude/agents/security-auditor.md",
    "scripts/ci/check-pr-guards.sh",
    "scripts/tests/agent-files.test.mjs",
    "scripts/tests/ci-db-scope.test.mjs",
  ];
  assert.equal(needsDbTests(unrelated), "false");
});

test("only paths from the repository root count", () => {
  assert.equal(needsDbTests(["docs/supabase/notes.md", "supabase-notes.md", "nested/package.json", "src/.nvmrc"]), "false");
});

test("one database file among many unrelated files is enough", () => {
  assert.equal(needsDbTests(["index.html", "app.js", "supabase/migrations/20261021010000_x.sql", "README.md"]), "true");
});

test("an empty change list leaves them off", () => {
  assert.equal(needsDbTests([]), "false");
});

test("every Database tests step after the scope step follows its result", () => {
  const workflow = load(readFileSync(workflowPath, "utf8"));
  const steps = workflow.jobs.db.steps;
  const scopeIndex = steps.findIndex((step) => step.id === "scope");
  assert.ok(scopeIndex > 0, "the db job needs a step with id: scope after checkout");
  assert.equal(steps[0].with?.["fetch-depth"], 0, "merge-base needs full history");

  const guarded = steps.slice(scopeIndex + 1);
  assert.ok(guarded.length >= 5, "setup-node, npm ci, supabase start, db:test, test:storage and stop");
  for (const step of guarded) {
    assert.match(String(step.if), /steps\.scope\.outputs\.run == 'true'/, JSON.stringify(step));
  }
  const stop = guarded.at(-1);
  assert.match(stop.run, /supabase stop/);
  assert.match(String(stop.if), /^always\(\) && /, "stop must run even when an earlier step failed");
});

test("the app job is never skipped", () => {
  const workflow = load(readFileSync(workflowPath, "utf8"));
  assert.equal(workflow.jobs.app.if, undefined);
  for (const step of workflow.jobs.app.steps) {
    assert.equal(step.if, undefined, JSON.stringify(step));
  }
});
