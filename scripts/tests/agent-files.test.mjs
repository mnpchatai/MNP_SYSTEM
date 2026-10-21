// ตรวจ frontmatter ของไฟล์ subagent ใน .claude/agents/*.md
// Claude Code ข้ามไฟล์ agent ที่ frontmatter อ่านเป็น YAML ไม่ผ่าน โดยไม่แจ้ง error จึงตรวจเฉพาะสิ่งที่ทำให้ไฟล์ "ไม่ถูกโหลด":
//   - มี frontmatter ระหว่างบรรทัด --- สองบรรทัด และทุกบรรทัดบนสุดเป็น "key: value" ไม่ซ้ำ key
//   - ค่าที่ไม่ใส่เครื่องหมายคำพูด (plain scalar) ห้ามมี ": " (อ่านไม่ผ่าน) หรือ " #" (ตัดค่าที่เหลือทิ้งเงียบ ๆ)
//     และห้ามขึ้นต้นด้วยอักขระพิเศษของ YAML เช่น ` * # , ] } & ! % @ หรือ "- " "? " ": " (เช่น description ที่ขึ้นต้นด้วย `coder`)
//   - name ตรงกับชื่อไฟล์ และมี description
// ไม่ได้เป็น YAML parser เต็ม: ค่าที่ขึ้นต้นด้วยเครื่องหมายคำพูด [ { | > และบรรทัดที่ย่อหน้า (รายการซ้อน) ข้ามไป
// ไม่ตรงค่าที่ model/effort ยอมรับ เพราะเอกสารไม่ระบุว่าค่าที่ไม่รู้จักทำให้ไฟล์ถูกข้ามหรือไม่ และ Claude Code อาจเพิ่มค่าใหม่
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const agentsDir = new URL("../../.claude/agents/", import.meta.url);

function frontmatterProblems(text, fileName) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!block) return ["no frontmatter between two --- lines at the top of the file"];

  const problems = [];
  const fields = new Map();
  block[1].split(/\r?\n/).forEach((line, index) => {
    const lineNo = index + 2;
    if (line.trim() === "" || line.startsWith("#") || /^\s/.test(line) || line.startsWith("- ")) return;
    const pair = line.match(/^([A-Za-z][\w-]*):(?: +(.*))?$/);
    if (!pair) {
      problems.push(`line ${lineNo}: not a "key: value" line`);
      return;
    }
    const [, key, raw = ""] = pair;
    const value = raw.trim();
    if (fields.has(key)) problems.push(`line ${lineNo}: duplicate key "${key}"`);
    fields.set(key, value);
    if (/^["'|>[{]/.test(value)) return;
    if (/^[,\]}#&*!%@`]/.test(value) || /^[-?:](\s|$)/.test(value)) {
      problems.push(`line ${lineNo}: "${key}" starts with a YAML indicator character in an unquoted value; quote the value or reword it`);
    }
    if (/:(\s|$)/.test(value)) problems.push(`line ${lineNo}: "${key}" has ": " in an unquoted value; quote the value or reword it`);
    if (/\s#/.test(value)) problems.push(`line ${lineNo}: "${key}" has " #" in an unquoted value, which starts a comment and cuts the rest; quote the value`);
  });

  const unquote = (value = "") => value.replace(/^(["'])(.*)\1$/, "$2").trim();
  const expectedName = fileName.replace(/\.md$/, "");
  if (unquote(fields.get("name")) !== expectedName) problems.push(`name must equal the file name "${expectedName}"`);
  if (!/^[a-z][a-z0-9-]*$/.test(expectedName)) problems.push("file name must be lowercase letters, digits and hyphens");
  const description = unquote(fields.get("description"));
  if (description === "") problems.push("description is missing or empty");
  else if (!/^["']/.test(fields.get("description")) && /^(~|null|true|false|[-+]?\d[\d.]*|\.\d+)$/i.test(description)) {
    problems.push("description reads as a YAML null, boolean or number, not text; quote it");
  }
  return problems;
}

const agent = (frontmatter) => `---\n${frontmatter}\n---\n\nBody text.\n`;

test("every agent file in .claude/agents has a frontmatter Claude Code can load", () => {
  const files = readdirSync(agentsDir).filter((name) => name.endsWith(".md"));
  assert.ok(files.length > 0, "found no agent files, so the check would pass without checking anything");
  for (const file of files) {
    assert.deepEqual(frontmatterProblems(readFileSync(new URL(file, agentsDir), "utf8"), file), [], file);
  }
});

test("a description with ': ' in it is rejected (the mistake that made coder.md fail to load)", () => {
  const text = agent("name: coder\ndescription: Implements a change in MNP_SYSTEM: features, bug fixes, tests.\ntools: Read, Edit");
  const problems = frontmatterProblems(text, "coder.md");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /line 3: "description" has ": "/);
});

test("the same text is accepted when quoted or reworded", () => {
  assert.deepEqual(frontmatterProblems(agent('name: coder\ndescription: "Implements a change in MNP_SYSTEM: features, tests."'), "coder.md"), []);
  assert.deepEqual(frontmatterProblems(agent("name: coder\ndescription: Implements a change in MNP_SYSTEM (features, tests)."), "coder.md"), []);
  assert.deepEqual(frontmatterProblems(agent("name: coder\ndescription: A colon with no space after it, like a:b, is fine; so is c#d"), "coder.md"), []);
});

test("an unquoted ' #' is rejected because YAML would silently drop the rest of the value", () => {
  const problems = frontmatterProblems(agent("name: coder\ndescription: Follows rule #1 of AGENTS.md"), "coder.md");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /line 3: "description" has " #"/);
});

test("an unquoted value that starts with a YAML indicator character is rejected", () => {
  for (const value of ["`coder` implements a change", "*important* agent", "@mention first", "- a dash then a space", "? a question mark then a space", "#hash first", ", comma first"]) {
    const problems = frontmatterProblems(agent(`name: coder\ndescription: ${value}`), "coder.md");
    assert.equal(problems.length, 1, value);
    assert.match(problems[0], /starts with a YAML indicator character/, value);
  }
  assert.deepEqual(frontmatterProblems(agent('name: coder\ndescription: "`coder` implements a change"'), "coder.md"), []);
  assert.deepEqual(frontmatterProblems(agent("name: coder\ndescription: -dash with no space, ?mark and :colon are plain text"), "coder.md"), []);
});

test("a trailing colon, a duplicate key and a line that is not key: value are rejected", () => {
  assert.match(frontmatterProblems(agent("name: coder\ndescription: Does things:"), "coder.md").join("\n"), /has ": "/);
  assert.match(frontmatterProblems(agent("name: coder\ndescription: One\ndescription: Two"), "coder.md").join("\n"), /duplicate key "description"/);
  assert.match(frontmatterProblems(agent("name: coder\ndescription: One\njust some words"), "coder.md").join("\n"), /not a "key: value" line/);
});

test("name must match the file name and description must be present", () => {
  assert.match(frontmatterProblems(agent("name: other\ndescription: x"), "coder.md").join("\n"), /name must equal the file name "coder"/);
  assert.match(frontmatterProblems(agent("name: coder"), "coder.md").join("\n"), /description is missing or empty/);
  assert.match(frontmatterProblems(agent('name: coder\ndescription: ""'), "coder.md").join("\n"), /description is missing or empty/);
  for (const value of ["~", "null", "true", "42"]) {
    assert.match(frontmatterProblems(agent(`name: coder\ndescription: ${value}`), "coder.md").join("\n"), /reads as a YAML null, boolean or number/, value);
  }
  assert.deepEqual(frontmatterProblems(agent('name: coder\ndescription: "42"'), "coder.md"), []);
});

test("a file without a closed frontmatter block is rejected", () => {
  assert.match(frontmatterProblems("name: coder\ndescription: x\n", "coder.md")[0], /no frontmatter/);
  assert.match(frontmatterProblems("---\nname: coder\ndescription: x\n", "coder.md")[0], /no frontmatter/);
});

test("nested lines, comments and flow or block values are left alone", () => {
  const text = agent("name: coder\ndescription: x\n# a comment\ntools:\n  - Read\n  - Edit\nmodel: sonnet");
  assert.deepEqual(frontmatterProblems(text, "coder.md"), []);
  assert.deepEqual(frontmatterProblems(agent("name: coder\ndescription: |\n  Long text: with a colon\ntools: [Read, Edit]"), "coder.md"), []);
});
