import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** 执行 git 命令并返回 stdout（去掉尾部换行） */
export async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await exec("git", args, {
      cwd,
      maxBuffer: 128 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (err: any) {
    const detail = err?.stderr?.trim() || err?.message || String(err);
    throw new Error(`git ${args.join(" ")} 失败：${detail}`);
  }
}

export async function currentBranch(cwd?: string): Promise<string> {
  const out = await git(["branch", "--show-current"], cwd);
  if (!out) throw new Error("无法获取当前分支，请确认在 git 仓库内.");
  return out;
}

/** 根据 diff 配置拼出 git diff 的额外参数 */
function scopeArgs(scope: string, base?: string): string[] {
  if (scope === "staged") return ["--cached"];
  if (scope === "range") return [`${base ?? "HEAD~1"}...HEAD`];
  return []; // working 树（未暂存）
}

/** 抓取 diff 原始文本 */
export async function diffRaw(
  scope: string,
  base?: string,
  cwd?: string
): Promise<string> {
  return git(["diff", ...scopeArgs(scope, base)], cwd);
}

/** 抓取变更文件清单（相对路径） */
export async function diffFiles(
  scope: string,
  base?: string,
  cwd?: string
): Promise<string[]> {
  const out = await git(
    ["diff", "--name-only", "--relative", ...scopeArgs(scope, base)],
    cwd
  );
  return out ? out.split("\n") : [];
}

/** 当前工作目录是否是 git 仓库 */
export async function isRepo(cwd?: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}

/** git 仓库根目录绝对路径；非 git 仓库返回 null */
export async function repoRoot(cwd?: string): Promise<string | null> {
  try {
    const out = await git(["rev-parse", "--show-toplevel"], cwd);
    return out || null;
  } catch {
    return null;
  }
}

/** 远端仓库可达性探测：git ls-remote 只取 refs（不拉对象）。
 *  必须双保险禁用交互：GIT_TERMINAL_PROMPT=0 关终端提示、GCM_INTERACTIVE=never 关
 *  Windows Git Credential Manager 的弹窗（否则访问需鉴权的地址会卡住不返回）。
 *  仍保留本机凭据助手，私有仓库若已存凭据可正常探测。
 *  ok=true 表示远端可访问（含私有仓库凭据被接受）；ok=false 时 message 为 git 首行错误，供调用方归类 */
export async function lsRemote(
  url: string,
  timeoutMs = 10000
): Promise<{ ok: boolean; message: string }> {
  try {
    await exec("git", ["ls-remote", "--exit-code", url], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, message: "远端仓库可访问" };
  } catch (err: any) {
    if (err?.killed || err?.signal) return { ok: false, message: "探测超时" };
    // 返回完整 stderr 供调用方归类：GCM 的「无法交互」噪音行会排在真正的
    // 「Repository not found」之前，只取首行会漏判，故整体回传
    const detail = (err?.stderr?.toString().trim() || err?.message || String(err)).trim();
    return { ok: false, message: detail };
  }
}

/** 列出已暂存（cached）的变更文件相对路径，空数组表示无暂存变更 */
export async function stagedFiles(cwd?: string): Promise<string[]> {
  const out = await git(["diff", "--cached", "--name-only", "--relative"], cwd);
  return out ? out.split("\n") : [];
}

/** 用指定提交信息提交已暂存的变更（execFile 直传参数，无 shell 注入风险） */
export async function commitStaged(message: string, cwd?: string): Promise<void> {
  await git(["commit", "-m", message], cwd);
}

/** 最近一次提交的元信息，供评审页面展示与改写 */
export interface CommitInfo {
  /** 完整 hash */
  hash: string;
  /** 短 hash */
  short: string;
  /** 作者 */
  author: string;
  /** 提交时间（ISO 8601） */
  date: string;
  /** 首行描述 */
  subject: string;
  /** 完整提交信息（含 body） */
  message: string;
}

/** 读取 HEAD 最近一次提交元信息；空仓库 / 非 git 目录返回 null */
export async function headCommit(cwd?: string): Promise<CommitInfo | null> {
  const out = await git(
    ["log", "-1", "--date=iso-strict", "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%B"],
    cwd
  ).catch(() => null);
  if (!out) return null;
  const [hash = "", short = "", author = "", date = "", subject = "", ...body] = out.split("\x1f");
  if (!hash || !subject) return null;
  return { hash, short, author, date, subject, message: (body.join("\x1f") || subject).trim() };
}

/** 改写最近一次提交的提交信息（amend，仅改信息不改变更内容；失败抛错） */
export async function amendCommitMessage(message: string, cwd?: string): Promise<void> {
  await git(["commit", "--amend", "-m", message], cwd);
}

/** 读取 origin remote URL（https 或 ssh 均可）；非 git 仓库 / 无 origin 返回 null */
export async function getRemoteUrl(cwd?: string): Promise<string | null> {
  try {
    return await git(["remote", "get-url", "origin"], cwd);
  } catch {
    return null;
  }
}

/** 从 remote URL 解析出 owner/repo（兼容 https://github.com/o/r.git 与 git@github.com:o/r.git）；
 *  非 GitHub 远端或解析失败返回 null */
export function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  // https://github.com/owner/repo(.git)
  const m1 = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i);
  if (m1) return { owner: m1[1], repo: m1[2] };
  // git@github.com:owner/repo.git 或 ssh://git@github.com/owner/repo.git
  const m2 = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i);
  if (m2) return { owner: m2[1], repo: m2[2] };
  return null;
}