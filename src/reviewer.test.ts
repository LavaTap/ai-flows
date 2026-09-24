import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff } from "./reviewer.js";

test("should return empty array when diff text is empty", () => {
  assert.deepEqual(parseDiff(""), []);
  assert.deepEqual(parseDiff("   \n  "), []);
});

test("should skip file header and return empty when no hunk present", () => {
  const d = "diff --git a/x.ts b/x.ts\nindex 123..456 100644\n--- a/x.ts\n+++ b/x.ts\n";
  assert.deepEqual(parseDiff(d), []);
});

test("should parse standard hunk and advance old/new line numbers correctly", () => {
  const d = "@@ -10,3 +10,4 @@ context\n ctx1\n-old2\n+new2\n+new3";
  const hunks = parseDiff(d);
  assert.equal(hunks.length, 1);
  const h = hunks[0];
  assert.equal(h.oldStart, 10);
  assert.equal(h.oldEnd, 12);
  assert.equal(h.newStart, 10);
  assert.equal(h.newEnd, 13);
  assert.equal(h.lines.length, 4);
  // 上下文行：oldNo + newNo 同时推进
  assert.deepEqual(h.lines[0], { type: "ctx", oldNo: 10, newNo: 10, text: "ctx1" });
  // 删除行：只推进 oldNo
  assert.deepEqual(h.lines[1], { type: "del", oldNo: 11, text: "old2" });
  // 新增行：只推进 newNo
  assert.deepEqual(h.lines[2], { type: "add", newNo: 11, text: "new2" });
  assert.deepEqual(h.lines[3], { type: "add", newNo: 12, text: "new3" });
});

test("should treat omitted hunk count as 1", () => {
  const d = "@@ -5 +5 @@\n+new";
  const h = parseDiff(d);
  assert.equal(h.length, 1);
  assert.equal(h[0].oldStart, 5);
  assert.equal(h[0].oldEnd, 5);
  assert.equal(h[0].newStart, 5);
  assert.equal(h[0].newEnd, 5);
  assert.equal(h[0].lines[0].newNo, 5);
});

test("should skip 'No newline at end of file' marker lines", () => {
  const d = "@@ -1,2 +1,2 @@\n ctx\n-old\n\\ No newline at end of file\n+new";
  const h = parseDiff(d);
  assert.equal(h[0].lines.length, 3); // ctx + del + add，标记行被跳过
  assert.equal(h[0].lines[1].type, "del");
  assert.equal(h[0].lines[1].oldNo, 2);
  assert.equal(h[0].lines[2].type, "add");
  assert.equal(h[0].lines[2].newNo, 2);
});

test("should parse multiple hunks in one file", () => {
  const d = "@@ -1,1 +1,1 @@\n ctxA\n@@ -10,1 +11,1 @@\n ctxB";
  const h = parseDiff(d);
  assert.equal(h.length, 2);
  assert.equal(h[0].newStart, 1);
  assert.equal(h[1].newStart, 11);
});
