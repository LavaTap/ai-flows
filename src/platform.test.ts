import { test } from "node:test";
import assert from "node:assert";
import { filterReviewsByUser } from "./platform.js";
import type { ReviewRecord, UserAccount } from "./db.js";

function user(role: "staff" | "supervisor", department: string): UserAccount {
  return {
    email: "t@ai-flows.com",
    password: "123456",
    role,
    title: "测试",
    department,
  };
}

function rec(department: string, source: "platform" | "external" = "platform"): ReviewRecord {
  return {
    id: "r",
    source,
    actor: "测试",
    email: "",
    department,
    role: "staff",
    generatedAt: "",
    passed: true,
    blockers: 0,
    issues: 0,
    reportUrl: "",
  };
}

test("should return all records when user is supervisor", () => {
  const records = [rec("产品调研"), rec("程序中台"), rec("AI产品")];
  const out = filterReviewsByUser(records, user("supervisor", "产品"));
  assert.strictEqual(out.length, 3);
});

test("should return only own-department records for staff", () => {
  const records = [rec("产品调研"), rec("程序中台"), rec("AI产品")];
  const out = filterReviewsByUser(records, user("staff", "程序中台"));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].department, "程序中台");
});

test("should keep external records assigned to 程序中台 visible to that department staff", () => {
  const records = [rec("程序中台", "external"), rec("产品调研")];
  const out = filterReviewsByUser(records, user("staff", "程序中台"));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].source, "external");
});

test("should return empty for staff of department with no records", () => {
  const out = filterReviewsByUser([rec("产品调研")], user("staff", "产品运营"));
  assert.strictEqual(out.length, 0);
});