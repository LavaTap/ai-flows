import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inflateRawSync } from "node:zlib";
import { buildZip, collectFiles, crc32 } from "./crawler.js";

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