import { test } from "node:test";
import assert from "node:assert";
import { sanitizeFilename, buildSkillPrompt, resolveSkillDoc, skillHasExecutables } from "./skill.js";

test("should keep basename and replace illegal chars when sanitizing filename", () => {
  assert.strictEqual(sanitizeFilename("a/b\\c.txt"), "c.txt");
  assert.strictEqual(sanitizeFilename('报告<2026>|"v1".md'), "报告_2026_v1_.md");
  assert.strictEqual(sanitizeFilename("../../../etc/passwd"), "passwd");
  assert.strictEqual(sanitizeFilename(""), "file");
  assert.strictEqual(sanitizeFilename("调研需求.md"), "调研需求.md");
});

test("should include requirement and delivery rules in prompt", () => {
  const p = buildSkillPrompt("做一个治愈系游戏调研", []);
  assert.ok(p.includes("## 需求描述"));
  assert.ok(p.includes("做一个治愈系游戏调研"));
  assert.ok(p.includes("## 交付要求"));
  assert.ok(!p.includes("## 附件"));
});

test("should append upload names and contents when uploads given", () => {
  const p = buildSkillPrompt("需求", [
    { name: "a.md", content: "附件正文内容" },
    { name: "b.bin", content: null },
  ]);
  assert.ok(p.includes("## 附件（2 个）"));
  assert.ok(p.includes("### a.md"));
  assert.ok(p.includes("附件正文内容"));
  assert.ok(p.includes("### b.bin"));
  assert.ok(p.includes("二进制附件"));
});

test("should fall back to hint text when requirement is empty", () => {
  const p = buildSkillPrompt("  ", []);
  assert.ok(p.includes("未填写需求文字"));
});

test("should throw when skill is unknown", () => {
  assert.throws(() => resolveSkillDoc("no-such-skill"), /未知 skill/);
});

test("should load installed skill doc without frontmatter", () => {
  const doc = resolveSkillDoc("product-manager");
  assert.ok(doc.length > 100);
  assert.ok(!doc.startsWith("---"));
});

test("should mark doc-only skill as not executable", () => {
  assert.strictEqual(skillHasExecutables("product-manager-skill"), false);
});

test("should mark skill shipping scripts as executable", () => {
  assert.strictEqual(skillHasExecutables("research-crawler-skill"), true);
});

test("should treat missing skill dir as not executable", () => {
  assert.strictEqual(skillHasExecutables("no-such-skill"), false);
});
