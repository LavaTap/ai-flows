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