import { spawn } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, basename, relative } from "node:path";
import { deflateRawSync } from "node:zlib";

/** 节点 01「产品调研」调研 agent 执行输入 */
export interface CrawlerRunInput {
  /** agent 项目根目录（绝对路径），agent 在该目录内运行 */
  root: string;
  /** agent CLI 可执行文件，如 claude */
  command: string;
  /** agent CLI 参数（需求文本经 stdin 传入，不拼进命令行） */
  args: string[];
  /** 需求文本：直接作为 agent prompt */
  requirement: string;
  /** agent 产出目录名（相对 root），打包对象 */
  outputDirName: string;
  /** zip 产物落盘绝对路径 */
  zipPath: string;
  /** 执行超时毫秒 */
  timeoutMs: number;
  /** 进度回调：pct 0-100 + 阶段文案 */
  onProgress: (pct: number, label: string) => void;
}

/** 调研 agent 执行结果 */
export interface CrawlerRunResult {
  /** 产物文件名（不含路径） */
  artifactName: string;
  /** 产物绝对路径 */
  artifactPath: string;
  /** 打进压缩包的文件数 */
  fileCount: number;
}

/** zip 条目：压缩包内相对路径（posix 分隔）+ 文件内容 */
export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** CRC32 查表（惰性构建，只算一次） */
let crcTable: Uint32Array | null = null;
function crc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** 计算 CRC32（zip 校验字段） */
export function crc32(buf: Buffer): number {
  const table = crc32Table();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Date → DOS 时间/日期对（zip 头字段，早于 1980 的按 1980-01-01 兜底） */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = d.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** 零依赖打包 zip（deflate-raw 压缩，UTF-8 文件名标志位）。
 *  仅支持文件条目，目录结构由条目名体现；空目录不入包。 */
export function buildZip(entries: ZipEntry[], now = new Date()): Buffer {
  const { time, date } = dosDateTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const compressed = deflateRawSync(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}

/** 递归收集目录下所有文件 → zip 条目（条目名为相对路径，统一 posix 分隔） */
export function collectFiles(root: string, base = root): ZipEntry[] {
  const out: ZipEntry[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, base));
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      out.push({ name: relative(base, full).replace(/\\/g, "/"), data: readFileSync(full) });
    } catch {
      /* 读取失败（占用/权限）单个文件跳过，不阻断整体打包 */
    }
  }
  return out;
}

/** 调 agent CLI：需求文本直接经 stdin 送入，避免长文本进命令行/注入 */
function runAgent(input: CrawlerRunInput): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.root,
      // Windows 下 agent CLI 多为 .cmd/.ps1 脚本，需经 shell 解析
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`调研 agent 执行超时（${Math.round(input.timeoutMs / 1000)}s）`));
    }, input.timeoutMs);

    child.stderr?.on("data", (c: Buffer) => {
      if (stderr.length < 4000) stderr += c.toString("utf8");
    });
    child.stdout?.on("data", (c: Buffer) => {
      if (stdout.length < 4000) stdout += c.toString("utf8");
    });
    child.on("error", (err) => finish(new Error(`无法启动调研 agent（${input.command}）：${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) return finish();
      const tail = (stderr || stdout).trim().split("\n").slice(-6).join(" ");
      finish(new Error(`调研 agent 退出码 ${code}${tail ? `：${tail}` : ""}`));
    });

    child.stdin?.on("error", () => {
      /* agent 未读 stdin 即退出时忽略 EPIPE */
    });
    child.stdin?.end(input.requirement);
  });
}

/** 执行一次产品调研：调 agent → 打包其 output 目录为 zip 产物。
 *  不感知节点/权限，进度经 onProgress 回调上报。 */
export async function runCrawler(input: CrawlerRunInput): Promise<CrawlerRunResult> {
  if (!input.requirement.trim()) throw new Error("调研需求内容为空，请先填写需求再执行");
  if (!existsSync(input.root) || !statSync(input.root).isDirectory()) {
    throw new Error(`调研 agent 目录不存在：${input.root}`);
  }
  const outputAbs = join(input.root, input.outputDirName);
  if (!existsSync(outputAbs) || !statSync(outputAbs).isDirectory()) {
    throw new Error(`调研 agent 输出目录不存在：${outputAbs}`);
  }

  input.onProgress(10, "启动调研 agent");
  await runAgent(input);

  input.onProgress(88, "打包输出目录");
  const entries = collectFiles(outputAbs);
  mkdirSync(dirname(input.zipPath), { recursive: true });
  writeFileSync(input.zipPath, buildZip(entries));

  input.onProgress(100, "完成");
  return { artifactName: basename(input.zipPath), artifactPath: input.zipPath, fileCount: entries.length };
}