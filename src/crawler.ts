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

/** agent CLI 执行参数（节点 01 调研与对话页 skill 执行共用） */
interface AgentExecInput {
  /** agent 运行目录（绝对路径） */
  root: string;
  /** agent CLI 可执行文件 */
  command: string;
  /** agent CLI 参数 */
  args: string[];
  /** 经 stdin 送入的 prompt（不拼进命令行，避免长文本与注入） */
  prompt: string;
  /** 执行超时毫秒 */
  timeoutMs: number;
  /** agent 输出增量回调（stdout / stderr 分块，供调用方实时回显「在跑什么」） */
  onOutput?: (chunk: string) => void;
}

/** agent stdout 捕获上限（对话页需回灌给模型，故比节点 01 的报错摘要宽） */
const AGENT_STDOUT_LIMIT = 60000;
/** agent stderr 捕获上限（仅用于失败时的报错摘要） */
const AGENT_STDERR_LIMIT = 4000;

/** 调 agent CLI：prompt 经 stdin 送入，返回捕获的 stdout / stderr */
function runAgent(input: AgentExecInput): Promise<{ stdout: string; stderr: string }> {
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
      else resolve({ stdout, stderr });
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`agent 执行超时（${Math.round(input.timeoutMs / 1000)}s）`));
    }, input.timeoutMs);

    child.stderr?.on("data", (c: Buffer) => {
      if (stderr.length < AGENT_STDERR_LIMIT) stderr += c.toString("utf8");
      input.onOutput?.(c.toString("utf8"));
    });
    child.stdout?.on("data", (c: Buffer) => {
      if (stdout.length < AGENT_STDOUT_LIMIT) stdout += c.toString("utf8");
      input.onOutput?.(c.toString("utf8"));
    });
    child.on("error", (err) => finish(new Error(`无法启动 agent（${input.command}）：${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) return finish();
      const tail = (stderr || stdout).trim().split("\n").slice(-6).join(" ");
      finish(new Error(`agent 退出码 ${code}${tail ? `：${tail}` : ""}`));
    });

    child.stdin?.on("error", () => {
      /* agent 未读 stdin 即退出时忽略 EPIPE */
    });
    child.stdin?.end(input.prompt);
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
  await runAgent({
    root: input.root,
    command: input.command,
    args: input.args,
    prompt: input.requirement,
    timeoutMs: input.timeoutMs,
  });

  input.onProgress(88, "打包输出目录");
  const entries = collectFiles(outputAbs);
  mkdirSync(dirname(input.zipPath), { recursive: true });
  writeFileSync(input.zipPath, buildZip(entries));

  input.onProgress(100, "完成");
  return { artifactName: basename(input.zipPath), artifactPath: input.zipPath, fileCount: entries.length };
}

/** 对话页执行「含脚本 skill」的输入：在 skill 项目根内跑 agent，产物即 agent 的输出文本 */
export interface SkillAgentInput {
  /** 执行根目录（skill 项目根，绝对路径） */
  root: string;
  /** agent CLI 可执行文件 */
  command: string;
  /** agent CLI 参数 */
  args: string[];
  /** 送 stdin 的 prompt（skill 说明 + 用户需求） */
  prompt: string;
  /** 执行超时毫秒 */
  timeoutMs: number;
  /** 进度回调：pct 0-100 + 阶段文案 */
  onProgress: (pct: number, label: string) => void;
  /** agent 输出行回调：按行切分后给出最近一行，供对话页回显「正在跑什么」 */
  onOutput?: (line: string) => void;
}

/** 在 skill 项目根内执行 agent 并回传其输出文本（供对话页回灌模型）。
 *  不感知节点/权限，进度经 onProgress 回调上报。 */
export async function runSkillAgent(input: SkillAgentInput): Promise<string> {
  if (!existsSync(input.root) || !statSync(input.root).isDirectory()) {
    throw new Error(`skill 执行目录不存在：${input.root}`);
  }

  input.onProgress(10, `启动脚本：${basename(input.command)}`);
  // 输出按行切分：残余半行留到下一块，避免把一行拆成两条状态文案
  let pending = "";
  const output = input.onOutput;
  const { stdout, stderr } = await runAgent({
    root: input.root,
    command: input.command,
    args: input.args,
    prompt: input.prompt,
    timeoutMs: input.timeoutMs,
    onOutput: output
      ? (chunk) => {
          pending += chunk;
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (t) output(t);
          }
        }
      : undefined,
  });

  input.onProgress(100, "完成");
  const text = stdout.trim() || stderr.trim();
  if (!text) throw new Error("skill agent 未产出任何输出");
  return text;
}

/** 打包结果：归档文件绝对路径 + 实际使用的工具（7z=外部 7-Zip；builtin=零依赖内置实现） */
export interface PackZipResult {
  /** 归档文件绝对路径 */
  path: string;
  /** 实际使用的打包工具 */
  tool: "7z" | "builtin";
  /** 打进包里的条目数 */
  count: number;
}

/** 由 PATH 与平台推导 7-Zip 可执行文件候选路径（纯函数，便于单测）。
 *  extra 为显式配置的命令，置顶优先。 */
export function sevenZipCandidates(
  pathEnv: string | undefined,
  platform: NodeJS.Platform,
  extra?: string
): string[] {
  const names = platform === "win32" ? ["7z.exe", "7za.exe", "7zz.exe"] : ["7z", "7za", "7zz"];
  const out: string[] = [];
  const push = (p: string) => {
    const t = p.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  if (extra) push(extra);
  for (const dir of (pathEnv ?? "").split(platform === "win32" ? ";" : ":")) {
    if (!dir.trim()) continue;
    for (const n of names) push(join(dir.trim(), n));
  }
  for (const p of platform === "win32"
    ? ["C:\\Program Files\\7-Zip\\7z.exe", "C:\\Program Files (x86)\\7-Zip\\7z.exe"]
    : ["/usr/bin/7z", "/usr/local/bin/7z", "/opt/homebrew/bin/7z"]) {
    push(p);
  }
  return out;
}

/** 探测可用的 7-Zip：返回第一个确实存在的可执行文件路径，找不到返回空串 */
function findSevenZip(extra?: string): string {
  for (const p of sevenZipCandidates(process.env.PATH, process.platform, extra)) {
    try {
      if (existsSync(p) && statSync(p).isFile()) return p;
    } catch {
      /* 无权限访问的候选跳过 */
    }
  }
  return "";
}

/** 跑一次外部打包命令；任何异常（未装 / 非零退出 / 超时）都归为失败，由调用方回退内置实现 */
function runPackCommand(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const child = spawn(cmd, args, { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, timeoutMs);
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}

/** 把若干文件打包成 zip：优先外部 7-Zip，未安装 / 执行失败则回退零依赖内置实现。
 *  条目名一律取相对 base 的 posix 路径，归档内不出现绝对路径。 */
export async function packZip(input: {
  /** 归档内路径的基准目录（绝对路径），同时作为 7-Zip 的工作目录 */
  base: string;
  /** 待打包的源文件绝对路径列表 */
  files: string[];
  /** 归档落盘绝对路径 */
  outPath: string;
  /** 7-Zip 可执行文件（缺省按 PATH 与常见安装路径自动探测） */
  command?: string;
  /** 外部命令超时毫秒，缺省 120000 */
  timeoutMs?: number;
}): Promise<PackZipResult> {
  const { base, files, outPath } = input;
  const names = files.map((f) => relative(base, f).replace(/\\/g, "/"));
  if (!files.length) throw new Error("没有可打包的文件");

  const sevenZip = findSevenZip(input.command);
  if (sevenZip) {
    const ok = await runPackCommand(
      sevenZip,
      ["a", "-tzip", "-y", "-bso0", "-bsp0", outPath, ...names],
      base,
      input.timeoutMs ?? 120000
    );
    if (ok) {
      try {
        if (existsSync(outPath) && statSync(outPath).size > 0) {
          return { path: outPath, tool: "7z", count: files.length };
        }
      } catch {
        /* 落到回退分支 */
      }
    }
  }

  const entries: ZipEntry[] = [];
  for (let i = 0; i < files.length; i++) {
    try {
      entries.push({ name: names[i], data: readFileSync(files[i]) });
    } catch {
      /* 读取失败（占用/权限）单个文件跳过，不阻断整体打包 */
    }
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buildZip(entries));
  return { path: outPath, tool: "builtin", count: entries.length };
}