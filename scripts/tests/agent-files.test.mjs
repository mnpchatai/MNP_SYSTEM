// ตรวจ frontmatter ของไฟล์ subagent ใน .claude/agents/**/*.md ด้วย YAML parser จริง (js-yaml)
// Claude Code ข้ามไฟล์ agent ที่ frontmatter อ่านเป็น YAML ไม่ผ่าน โดยไม่แจ้ง error จึงตรวจสิ่งที่ทำให้ไฟล์ "ไม่ถูกโหลด":
//   - มี frontmatter ระหว่างบรรทัด --- สองบรรทัดที่ต้นไฟล์ และ YAML อ่านผ่านเป็น mapping (key ซ้ำ, ย่อหน้าผิด, ": " ในค่า,
//     เครื่องหมายคำพูด/วงเล็บที่ไม่ปิด ฯลฯ ล้วนทำให้ไม่ผ่าน)
//   - description เป็นข้อความที่ไม่ว่าง (ค่าที่ YAML อ่านเป็น null, ตัวเลข, วันที่ ไม่นับ)
//   - ค่า description แบบ plain ที่มี " #" ถูก YAML ตัดทิ้งเงียบ ๆ (ส่วนหลัง # เป็น comment) จึงเทียบข้อความที่เขียนกับที่ parser อ่านได้
// name ต้องตรงชื่อไฟล์ และชื่อไฟล์เป็นตัวพิมพ์เล็ก ตัวเลข และ - เป็น convention ของ repo (เอกสารไม่ได้ระบุว่าทำให้ไฟล์ถูกข้าม)
// ข้อจำกัด: ใช้ js-yaml เป็นตัวแทน parser ของ Claude Code ซึ่งไม่ทราบว่าใช้ตัวไหน (ผลต่างกันได้ในกรณีแปลก ๆ)
// ไม่ตรงค่าที่ model/effort ยอมรับ เพราะเอกสารไม่ระบุว่าค่าที่ไม่รู้จักทำให้ไฟล์ถูกข้ามหรือไม่ และ Claude Code อาจเพิ่มค่าใหม่
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { load } from "js-yaml";

const agentsDir = new URL("../../.claude/agents/", import.meta.url);

// ข้อความ description เท่าที่เขียนไว้ (กรณี plain scalar หลายบรรทัดจะต่อด้วยช่องว่างเหมือนที่ YAML พับบรรทัด)
// คืน null ถ้าขึ้นต้นด้วยเครื่องหมายคำพูด | > [ { ซึ่งเป็น YAML ที่ผู้เขียนตั้งใจใช้ parser อ่านได้ตามนั้น
// (ค่าที่ขึ้นต้นด้วย & หรือ ! ยังเทียบ เพราะ parser ตัดชื่อ anchor/tag ทิ้งเงียบ ๆ)
function plainDescriptionRegion(frontmatter) {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => /^description:/.test(line));
  if (start === -1) return null;
  const first = lines[start].replace(/^description:\s*/, "");
  if (first === "" || /^["'|>[{]/.test(first)) return null;
  const parts = [first];
  for (let index = start + 1; index < lines.length && (lines[index].trim() === "" || /^\s/.test(lines[index])); index += 1) {
    if (lines[index].trim() !== "") parts.push(lines[index].trim());
  }
  return parts.join(" ");
}

function frontmatterProblems(text, fileName) {
  if (text.startsWith("﻿")) return ["file starts with a byte order mark (BOM), so the frontmatter may not be recognized"];
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!block) return ["no frontmatter between two --- lines at the top of the file"];

  let data;
  try {
    data = load(block[1]);
  } catch (error) {
    const where = error.mark ? ` (line ${error.mark.line + 2})` : "";
    return [`YAML does not parse${where}: ${error.reason ?? error.message}`];
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return ["frontmatter is not a mapping of keys to values"];

  const problems = [];
  const expectedName = fileName.replace(/\.md$/i, "");
  if (data.name !== expectedName) problems.push(`name must equal the file name "${expectedName}"`);
  if (!/^[a-z][a-z0-9-]*$/.test(expectedName)) problems.push("file name must be lowercase letters, digits and hyphens");
  if (typeof data.description !== "string" || data.description.trim() === "") {
    problems.push("description is missing, empty, or not text (YAML read it as a number, boolean, date or null; quote it)");
  } else {
    const written = plainDescriptionRegion(block[1]);
    if (written !== null && written.replace(/\s+/g, " ").trim() !== data.description.replace(/\s+/g, " ").trim()) {
      problems.push('description lost text when read as YAML: an unquoted " #" starts a comment and drops the rest; quote the value');
    }
  }
  return problems;
}

const agent = (frontmatter) => `---\n${frontmatter}\n---\n\nBody text.\n`;
const problemsOf = (frontmatter, fileName = "coder.md") => frontmatterProblems(agent(frontmatter), fileName);

test("every agent file in .claude/agents has a frontmatter Claude Code can load", () => {
  const files = readdirSync(agentsDir, { recursive: true }).filter((name) => /\.md$/i.test(name));
  assert.ok(files.length > 0, "found no agent files, so the check would pass without checking anything");
  for (const file of files) {
    assert.deepEqual(frontmatterProblems(readFileSync(new URL(file, agentsDir), "utf8"), path.basename(file)), [], file);
  }
});

test("a description with ': ' in it is rejected (the mistake that made coder.md fail to load)", () => {
  const problems = problemsOf("name: coder\ndescription: Implements a change in MNP_SYSTEM: features, bug fixes, tests.\ntools: Read, Edit");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^YAML does not parse \(line 3\)/);
});

test("the same mistake on a wrapped continuation line is rejected too", () => {
  const problems = problemsOf("name: coder\ndescription: Implements a change\n  in MNP_SYSTEM: features and tests\ntools: Read");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^YAML does not parse/);
});

test("the same text is accepted when quoted, reworded or put in a block scalar", () => {
  assert.deepEqual(problemsOf('name: coder\ndescription: "Implements a change in MNP_SYSTEM: features, tests."'), []);
  assert.deepEqual(problemsOf("name: coder\ndescription: Implements a change in MNP_SYSTEM (features, tests)."), []);
  assert.deepEqual(problemsOf("name: coder\ndescription: >\n  Implements a change in MNP_SYSTEM: features,\n  tests, and migrations."), []);
  assert.deepEqual(problemsOf("name: coder\ndescription: Implements a change\n  in MNP_SYSTEM (features and tests)"), []);
  assert.deepEqual(problemsOf("name: coder\ndescription: A colon with no space after it, like a:b, is fine; so is c#d"), []);
});

test("an unquoted ' #' is rejected because YAML would silently drop the rest of the value", () => {
  for (const frontmatter of [
    "name: coder\ndescription: Follows rule #1 of AGENTS.md",
    "name: coder\ndescription: Follows the rules\n  of AGENTS.md # and more",
  ]) {
    const problems = problemsOf(frontmatter);
    assert.equal(problems.length, 1, frontmatter);
  }
  assert.match(problemsOf("name: coder\ndescription: Follows rule #1 of AGENTS.md")[0], /lost text/);
  assert.match(problemsOf("name: coder\ndescription: &note Keeps the text but YAML drops the anchor name")[0], /lost text/);
  assert.match(problemsOf("name: coder\ndescription: !!str Same for a tag")[0], /lost text/);
  assert.deepEqual(problemsOf('name: coder\ndescription: "Follows rule #1 of AGENTS.md"'), []);
});

test("unquoted values that YAML cannot read or reads as something else are rejected", () => {
  for (const value of [
    "`coder` implements a change",
    "*important* agent",
    "@mention first",
    "- a dash then a space",
    "? a question mark then a space",
    "#hash first",
    ", comma first",
    "[Read-only] investigation",
    "{a} b",
    '"Use it" when needed',
    '"unterminated',
    "'unterminated",
    "| text",
    "null",
    "~",
    "true",
    "42",
    "2024-01-01",
  ]) {
    assert.ok(problemsOf(`name: coder\ndescription: ${value}`).length > 0, value);
  }
});

test("other fields written wrongly are rejected as well", () => {
  assert.ok(problemsOf("name: coder\ndescription: x\ntools: [Read, Edit").length > 0);
  assert.ok(problemsOf('name: coder\ndescription: x\ntools: "Read, Edit" extra').length > 0);
  assert.ok(problemsOf("name: coder\ndescription: x\nmodel: claude: x").length > 0);
  assert.ok(problemsOf("name: coder\ndescription: x\n\ttools: Read").length > 0);
  assert.match(problemsOf("name: coder\ndescription: One\ndescription: Two")[0], /duplicated mapping key/);
});

test("name must match the file name and description must be text", () => {
  assert.match(problemsOf("name: other\ndescription: x").join("\n"), /name must equal the file name "coder"/);
  assert.match(problemsOf("description: x").join("\n"), /name must equal the file name "coder"/);
  assert.match(problemsOf("name: coder").join("\n"), /description is missing, empty, or not text/);
  assert.match(problemsOf('name: coder\ndescription: ""').join("\n"), /description is missing, empty, or not text/);
  assert.match(problemsOf("name: coder\ndescription: |").join("\n"), /description is missing, empty, or not text/);
  assert.match(frontmatterProblems(agent("name: Coder\ndescription: x"), "Coder.md").join("\n"), /lowercase letters, digits and hyphens/);
});

test("a file without a closed frontmatter block, or with a BOM, is rejected", () => {
  assert.match(frontmatterProblems("name: coder\ndescription: x\n", "coder.md")[0], /no frontmatter/);
  assert.match(frontmatterProblems("---\nname: coder\ndescription: x\n", "coder.md")[0], /no frontmatter/);
  assert.match(frontmatterProblems(`﻿${agent("name: coder\ndescription: x")}`, "coder.md")[0], /byte order mark/);
});

test("valid YAML the real files do not use today is still accepted", () => {
  assert.deepEqual(problemsOf("name: coder\ndescription: x\n# a comment\ntools:\n  - Read\n  - Edit\nmodel: sonnet"), []);
  assert.deepEqual(problemsOf("name: coder\ndescription: |\n  Long text: with a colon\ntools: [Read, Edit]"), []);
});
