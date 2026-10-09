import { test } from "node:test";
import assert from "node:assert/strict";
import { canReuseReview } from "./serve.js";

test("should reuse when range scope and HEAD matches last reviewed commit", () => {
  assert.strictEqual(canReuseReview("range", "abc123", "abc123", false), true);
});

test("should not reuse when range scope and HEAD moved to a new commit", () => {
  assert.strictEqual(canReuseReview("range", "abc123", "def456", false), false);
});

test("should not reuse when range scope and head hash is unavailable", () => {
  assert.strictEqual(canReuseReview("range", "abc123", null, false), false);
});

test("should reuse when staged scope and current diff is empty", () => {
  assert.strictEqual(canReuseReview("staged", "abc123", "zzz999", true), true);
});

test("should not reuse when staged scope still has pending changes", () => {
  assert.strictEqual(canReuseReview("staged", "abc123", "zzz999", false), false);
});

test("should reuse when working scope and current diff is empty", () => {
  assert.strictEqual(canReuseReview("working", "abc123", "zzz999", true), true);
});

test("should not reuse when previous report recorded no reviewed commit", () => {
  assert.strictEqual(canReuseReview("range", undefined, "abc123", false), false);
  assert.strictEqual(canReuseReview("staged", undefined, "abc123", true), false);
});