import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inflateRawSync } from "node:zlib";
import { buildZip, collectFiles, crc32, sevenZipCandidates } from "./crawler.js";

test("should match the known CRC32 value when given the standard check string", () => {
  assert.equal(crc32(Buffer.from("123456789", "utf8")), 0xcbf43926);
});

test("should round-trip a UTF-8 file when zipped and inflated", () => {
  const content = "hello 世界\n";
  const zip = buildZip([{ name: "a/b.txt", data: Buffer.from(content, "utf8") }]);

  assert.equal(zip.readUInt32LE(0), 0x04034b50, "缺少本地文件头签名");
  const fnlen = zip.readUInt16LE(26);
  const csize = zip.readUInt32LE(18);
  const usize = zip.readUInt32LE(22);
  assert.equal(zip.subarray(30, 30 + fnlen).toString("utf8"), "a/b.txt");

  const inflated = inflateRawSync(zip.subarray(30 + fnlen, 30 + fnlen + csize));
  assert.equal(inflated.length, usize);
  assert.equal(inflated.toString("utf8"), content);

  // 中央目录 + 结束记录：条目数应为 1
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50, "缺少中央目录结束记录");
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 1);
});

test("should produce a valid empty archive when given no entries", () => {
  const zip = buildZip([]);
  assert.equal(zip.length, 22);
  assert.equal(zip.readUInt32LE(0), 0x06054b50);
  assert.equal(zip.readUInt16LE(8), 0);
});

test("should list nested files with posix separators when collecting a directory", () => {
  const root = mkdtempSync(join(tmpdir(), "crawler-test-"));
  try {
    mkdirSync(join(root, "bilibili", "g"), { recursive: true });
    writeFileSync(join(root, "top.txt"), "top");
    writeFileSync(join(root, "bilibili", "g", "out.csv"), "a,b");

    const entries = collectFiles(root).sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(
      entries.map((e) => e.name),
      ["bilibili/g/out.csv", "top.txt"]
    );
    assert.equal(entries[0].data.toString("utf8"), "a,b");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("should put the explicit 7-Zip command first when it is configured", () => {
  const out = sevenZipCandidates("C:/bin;D:/tools", "win32", "C:/custom/7z.exe");
  assert.equal(out[0], "C:/custom/7z.exe");
});

test("should list every exe name in every PATH directory when probing on windows", () => {
  const out = sevenZipCandidates("C:/bin;D:/tools", "win32");
  assert.ok(out.includes(join("C:/bin", "7z.exe")));
  assert.ok(out.includes(join("C:/bin", "7za.exe")));
  assert.ok(out.includes(join("D:/tools", "7zz.exe")));
  assert.ok(out.includes("C:\\Program Files\\7-Zip\\7z.exe"));
});

test("should use colon separated PATH and bare names when probing on posix", () => {
  const out = sevenZipCandidates("/usr/bin:/opt/bin", "linux");
  assert.ok(out.includes(join("/usr/bin", "7z")));
  assert.ok(out.includes(join("/opt/bin", "7za")));
  assert.ok(!out.some((p) => p.endsWith(".exe")));
});

test("should tolerate a missing PATH and still fall back to common install paths", () => {
  const out = sevenZipCandidates(undefined, "win32");
  assert.deepEqual(out, ["C:\\Program Files\\7-Zip\\7z.exe", "C:\\Program Files (x86)\\7-Zip\\7z.exe"]);
});

test("should drop blank and duplicate entries when building the 7-Zip candidate list", () => {
  const out = sevenZipCandidates(";C:/bin;;C:/bin", "win32");
  assert.equal(new Set(out).size, out.length);
  assert.ok(!out.includes(""));
});