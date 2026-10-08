import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  isHashed,
  passwordStatus,
  verifyPassword,
  PASSWORD_MAX_AGE_DAYS,
} from "./password.js";

test("should verify the correct password when stored as a scrypt hash", () => {
  const stored = hashPassword("newPass123");
  assert.ok(isHashed(stored));
  assert.equal(verifyPassword(stored, "newPass123"), true);
  assert.equal(verifyPassword(stored, "newPass124"), false);
});

test("should produce different hashes for the same password when salts differ", () => {
  assert.notEqual(hashPassword("same"), hashPassword("same"));
});

test("should verify against plaintext when the stored password predates hashing", () => {
  assert.equal(isHashed("123456"), false);
  assert.equal(verifyPassword("123456", "123456"), true);
  assert.equal(verifyPassword("123456", "654321"), false);
});

test("should reject a malformed hash when verifying", () => {
  assert.equal(verifyPassword("scrypt$zz$zz", "x"), false);
  assert.equal(verifyPassword("scrypt$", "x"), false);
  assert.equal(verifyPassword("scrypt$abcd$", "x"), false);
});

test("should treat the password as fresh when it has never been changed", () => {
  const now = new Date("2026-09-30T10:00:00.000Z");
  const st = passwordStatus(null, now);
  assert.equal(st.expired, false);
  assert.equal(st.daysLeft, PASSWORD_MAX_AGE_DAYS);
  assert.equal(st.dueAt, "2026-10-10T10:00:00.000Z");
});

test("should report the remaining days when the password is still within its lifetime", () => {
  const now = new Date("2026-09-30T10:00:00.000Z");
  const st = passwordStatus("2026-09-21T10:00:00.000Z", now);
  assert.equal(st.expired, false);
  assert.equal(st.daysLeft, 1);
});

test("should flag the password as expired when it reaches the age limit", () => {
  const now = new Date("2026-09-30T10:00:00.000Z");
  const atLimit = passwordStatus("2026-09-20T10:00:00.000Z", now);
  assert.equal(atLimit.expired, true);
  assert.equal(atLimit.daysLeft, 0);

  const overLimit = passwordStatus("2026-09-01T10:00:00.000Z", now);
  assert.equal(overLimit.expired, true);
  assert.equal(overLimit.daysLeft, 0);
});

test("should fall back to now when the stored change time is unparsable", () => {
  const now = new Date("2026-09-30T10:00:00.000Z");
  const st = passwordStatus("not-a-date", now);
  assert.equal(st.expired, false);
  assert.equal(st.since, now.toISOString());
});